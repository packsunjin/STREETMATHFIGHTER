const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL 환경변수가 설정되지 않았습니다. .env에 무료 Postgres(Neon 등) 연결 문자열을 넣어주세요.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// pg Pool은 대기 중인(idle) 커넥션에서 발생하는 에러를 'error' 이벤트로 내보내는데,
// 리스너가 없으면 Node가 처리되지 않은 예외로 보고 프로세스 전체가 죽어버림
// (일시적인 DB 커넥션 끊김 한 번으로 서버 전체가 다운되는 것을 방지).
pool.on('error', (err) => {
  console.error('예상치 못한 DB 커넥션 풀 에러:', err);
});

const DIFFICULTIES = ['상', '중', '하'];
const QUESTION_TYPES = ['objective', 'subjective'];
const OBJECTIVE_CHOICES = ['1', '2', '3', '4', '5'];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS problems (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('상', '중', '하')),
    image_path TEXT NOT NULL,
    image_public_id TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  ALTER TABLE problems
    ADD COLUMN IF NOT EXISTS question_type TEXT NOT NULL DEFAULT 'subjective';

  ALTER TABLE problems
    DROP CONSTRAINT IF EXISTS problems_question_type_check;

  ALTER TABLE problems
    ADD CONSTRAINT problems_question_type_check CHECK (question_type IN ('objective', 'subjective'));

  ALTER TABLE problems
    ADD COLUMN IF NOT EXISTS answer TEXT;

  ALTER TABLE problems
    ADD COLUMN IF NOT EXISTS unit TEXT;

  CREATE INDEX IF NOT EXISTS idx_problems_difficulty ON problems (difficulty);
  CREATE INDEX IF NOT EXISTS idx_problems_unit ON problems (unit);
  CREATE INDEX IF NOT EXISTS idx_problems_difficulty_unit ON problems (difficulty, unit);

  -- 학생이 문제를 풀고 채점한 기록. 학생 로그인이 없는 서비스라, 브라우저에
  -- 저장해둔 student_key(무작위 문자열)로 같은 학생을 구분하고 이름은 선택 입력.
  CREATE TABLE IF NOT EXISTS attempts (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    student_key TEXT NOT NULL,
    student_name TEXT,
    correct BOOLEAN NOT NULL,
    submitted_answer TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- 학생이 사진 위에 쓴 풀이(획 좌표). 용량이 커서 목록 조회에는 절대 섞지 않고,
  -- 한 건씩 따로 읽는다. 없는 경우가 많아 NULL 허용.
  ALTER TABLE attempts ADD COLUMN IF NOT EXISTS work JSONB;

  -- 강당에서 진행하는 라이브 이벤트 기록.
  -- attempts와 달리 문제가 지워져도 남아야 한다(누가 무슨 상 받았는지는 사실 기록이라
  -- 나중에 문제를 삭제했다고 사라지면 안 됨) -> ON DELETE SET NULL + 제목 스냅샷.
  CREATE TABLE IF NOT EXISTS show_rounds (
    id SERIAL PRIMARY KEY,
    problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
    problem_title TEXT,
    difficulty TEXT,
    student_name TEXT NOT NULL,
    correct BOOLEAN NOT NULL,
    prize TEXT,
    duration_ms INTEGER,
    work JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_show_rounds_created ON show_rounds (created_at DESC);

  CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts (student_key, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_attempts_problem ON attempts (problem_id);
  CREATE INDEX IF NOT EXISTS idx_attempts_created ON attempts (created_at DESC);
`;

// 스키마 생성(DDL)은 한 번에 한 프로세스만 하도록 자문 잠금으로 감싼다.
// 인스턴스가 둘 이상 동시에 뜨면(배포 중 롤링 재시작, 테스트 병렬 실행 등)
// CREATE/ALTER가 서로 물려 한쪽이 실패하는데, 그 프로세스는 컬럼이 없는 상태로
// 요청을 받게 된다. 잠금 번호는 이 프로젝트 전용의 임의 상수.
const SCHEMA_LOCK_ID = 771102;

const ready = (async () => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK_ID]);
    await client.query(SCHEMA_SQL);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK_ID]).catch(() => {});
    client.release();
  }
})();

async function listProblems({ difficulty, unit } = {}) {
  await ready;
  const conditions = [];
  const values = [];
  if (difficulty) {
    values.push(difficulty);
    conditions.push(`difficulty = $${values.length}`);
  }
  if (unit) {
    values.push(unit);
    conditions.push(`unit = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT * FROM problems ${where} ORDER BY created_at DESC`,
    values
  );
  return rows;
}

async function listUnits({ difficulty } = {}) {
  await ready;
  if (difficulty) {
    const { rows } = await pool.query(
      `SELECT DISTINCT unit FROM problems WHERE difficulty = $1 AND unit IS NOT NULL AND unit <> '' ORDER BY unit`,
      [difficulty]
    );
    return rows.map((r) => r.unit);
  }
  const { rows } = await pool.query(
    `SELECT DISTINCT unit FROM problems WHERE unit IS NOT NULL AND unit <> '' ORDER BY unit`
  );
  return rows.map((r) => r.unit);
}

async function getProblem(id) {
  await ready;
  const { rows } = await pool.query('SELECT * FROM problems WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createProblem({
  title,
  difficulty,
  image_path,
  image_public_id,
  description,
  question_type,
  answer,
  unit,
}) {
  await ready;
  const { rows } = await pool.query(
    `INSERT INTO problems (title, difficulty, image_path, image_public_id, description, question_type, answer, unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      title,
      difficulty,
      image_path,
      image_public_id,
      description || null,
      question_type || 'subjective',
      answer || null,
      unit || null,
    ]
  );
  return rows[0];
}

async function updateProblem(
  id,
  { title, difficulty, image_path, image_public_id, description, question_type, answer, unit }
) {
  await ready;
  const existing = await getProblem(id);
  if (!existing) return null;

  const { rows } = await pool.query(
    `UPDATE problems SET
       title = $1,
       difficulty = $2,
       image_path = $3,
       image_public_id = $4,
       description = $5,
       question_type = $6,
       answer = $7,
       unit = $8,
       updated_at = now()
     WHERE id = $9
     RETURNING *`,
    [
      title ?? existing.title,
      difficulty ?? existing.difficulty,
      image_path ?? existing.image_path,
      image_public_id ?? existing.image_public_id,
      description !== undefined ? description : existing.description,
      question_type ?? existing.question_type,
      answer !== undefined ? answer : existing.answer,
      unit !== undefined ? unit : existing.unit,
      id,
    ]
  );
  return rows[0];
}

async function deleteProblem(id) {
  await ready;
  const { rows } = await pool.query('DELETE FROM problems WHERE id = $1 RETURNING *', [id]);
  return rows[0] || null;
}

// ---- 학생 풀이 기록 ----

async function recordAttempt({
  problem_id,
  student_key,
  student_name,
  correct,
  submitted_answer,
  duration_ms,
}) {
  await ready;
  const { rows } = await pool.query(
    `INSERT INTO attempts (problem_id, student_key, student_name, correct, submitted_answer, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      problem_id,
      student_key,
      student_name || null,
      Boolean(correct),
      submitted_answer == null ? null : String(submitted_answer).slice(0, 500),
      Number.isFinite(duration_ms) ? Math.max(0, Math.round(duration_ms)) : null,
    ]
  );
  return rows[0];
}

// ---- 강당 라이브 이벤트 ----

// 한 라운드(한 학생이 한 문제에 도전한 결과)를 기록한다.
async function recordShowRound({
  problem_id,
  problem_title,
  difficulty,
  student_name,
  correct,
  prize,
  duration_ms,
  work,
}) {
  await ready;
  const { rows } = await pool.query(
    `INSERT INTO show_rounds
       (problem_id, problem_title, difficulty, student_name, correct, prize, duration_ms, work)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      problem_id || null,
      problem_title ? String(problem_title).slice(0, 200) : null,
      difficulty || null,
      String(student_name).slice(0, 40),
      Boolean(correct),
      prize ? String(prize).slice(0, 60) : null,
      Number.isFinite(duration_ms) ? Math.max(0, Math.round(duration_ms)) : null,
      work || null,
    ]
  );
  return rows[0];
}

// 진행 화면에 띄울 기록. sinceHours 안에 있었던 라운드만(기본: 오늘 진행분).
async function listShowRounds({ sinceHours = 12, limit = 100 } = {}) {
  await ready;
  const hours = Math.min(Math.max(Number(sinceHours) || 12, 1), 24 * 365);
  const { rows } = await pool.query(
    `SELECT id, problem_id, problem_title, difficulty, student_name, correct,
            prize, duration_ms, created_at
     FROM show_rounds
     WHERE created_at >= now() - ($1::text || ' hours')::interval
     ORDER BY created_at DESC
     LIMIT $2`,
    [String(hours), Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows;
}

// 같은 회차에서 같은 문제가 또 나오지 않게, 최근에 쓴 문제 번호를 준다.
async function listUsedProblemIds(sinceHours = 12) {
  await ready;
  const hours = Math.min(Math.max(Number(sinceHours) || 12, 1), 24 * 365);
  const { rows } = await pool.query(
    `SELECT DISTINCT problem_id
     FROM show_rounds
     WHERE problem_id IS NOT NULL
       AND created_at >= now() - ($1::text || ' hours')::interval`,
    [String(hours)]
  );
  return rows.map((row) => row.problem_id);
}

// 상품 이름은 매번 새로 치기 귀찮으니 전에 쓴 걸 자동완성으로 띄운다.
async function listRecentPrizes(limit = 12) {
  await ready;
  const { rows } = await pool.query(
    `SELECT prize, MAX(created_at) AS last_used
     FROM show_rounds
     WHERE prize IS NOT NULL AND prize <> ''
     GROUP BY prize
     ORDER BY MAX(created_at) DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 12, 1), 50)]
  );
  return rows.map((row) => row.prize);
}

// 채점 직후 학생이 쓴 풀이(획)를 해당 시도에 붙인다.
// student_key까지 조건에 넣어, 남의 시도에 덮어쓰는 걸 SQL 레벨에서 막는다.
async function saveAttemptWork(attemptId, studentKey, work) {
  await ready;
  const { rows } = await pool.query(
    `UPDATE attempts SET work = $3 WHERE id = $1 AND student_key = $2 RETURNING id`,
    [attemptId, studentKey, work]
  );
  return rows[0] || null;
}

// 학생 본인이 자기 풀이를 다시 볼 때. 문제당 가장 최근에 남긴 풀이 하나.
async function getLatestWorkForProblem(studentKey, problemId) {
  await ready;
  const { rows } = await pool.query(
    `SELECT id, work, correct, created_at
     FROM attempts
     WHERE student_key = $1 AND problem_id = $2 AND work IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [studentKey, problemId]
  );
  return rows[0] || null;
}

// 선생님이 "이 학생이 이 문제를 어떻게 풀었나"를 볼 때 쓰는 목록(풀이 본문은 제외).
async function listAttemptsWithWork({ studentKey, problemId, limit = 30 } = {}) {
  await ready;
  const conditions = ['a.work IS NOT NULL'];
  const values = [];
  if (studentKey) {
    values.push(studentKey);
    conditions.push(`a.student_key = $${values.length}`);
  }
  if (problemId) {
    values.push(problemId);
    conditions.push(`a.problem_id = $${values.length}`);
  }
  values.push(Math.min(Math.max(Number(limit) || 30, 1), 100));

  const { rows } = await pool.query(
    `SELECT a.id, a.problem_id, a.student_key, a.student_name, a.correct,
            a.submitted_answer, a.duration_ms, a.created_at,
            p.title, p.difficulty, p.unit, p.image_path
     FROM attempts a
     JOIN problems p ON p.id = a.problem_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return rows;
}

// 선생님용 단건 조회(풀이 본문 포함).
async function getAttemptWork(attemptId) {
  await ready;
  const { rows } = await pool.query(
    `SELECT a.id, a.problem_id, a.student_key, a.student_name, a.correct,
            a.submitted_answer, a.duration_ms, a.created_at, a.work,
            p.title, p.difficulty, p.unit, p.image_path
     FROM attempts a
     JOIN problems p ON p.id = a.problem_id
     WHERE a.id = $1`,
    [attemptId]
  );
  return rows[0] || null;
}

// 한 학생의 전체 성적 요약(총 시도/정답 수, 난이도별, 최근 활동일)
async function getStudentSummary(studentKey) {
  await ready;
  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE a.correct)::int AS correct,
       COUNT(DISTINCT a.problem_id)::int AS distinct_problems,
       MAX(a.created_at) AS last_solved_at
     FROM attempts a
     WHERE a.student_key = $1`,
    [studentKey]
  );
  const byDifficulty = await pool.query(
    `SELECT p.difficulty,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.correct)::int AS correct
     FROM attempts a
     JOIN problems p ON p.id = a.problem_id
     WHERE a.student_key = $1
     GROUP BY p.difficulty`,
    [studentKey]
  );
  return { ...rows[0], byDifficulty: byDifficulty.rows };
}

// 최근 기록부터 순서대로(연속 정답 계산 등에 사용)
async function listRecentAttempts(studentKey, limit = 30) {
  await ready;
  const { rows } = await pool.query(
    `SELECT a.correct, a.created_at, p.title, p.difficulty
     FROM attempts a
     JOIN problems p ON p.id = a.problem_id
     WHERE a.student_key = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [studentKey, Math.min(Math.max(Number(limit) || 30, 1), 100)]
  );
  return rows;
}

// 오답 노트: 마지막 시도가 오답인 문제들(그 뒤에 맞혔으면 목록에서 빠짐)
async function listWrongProblems(studentKey, limit = 50) {
  await ready;
  const { rows } = await pool.query(
    `WITH last_attempt AS (
       SELECT DISTINCT ON (problem_id)
              problem_id, correct, created_at
       FROM attempts
       WHERE student_key = $1
       ORDER BY problem_id, created_at DESC
     )
     SELECT p.id, p.title, p.difficulty, p.unit, p.image_path, p.question_type,
            la.created_at AS last_tried_at,
            EXISTS (
              SELECT 1 FROM attempts w
              WHERE w.student_key = $1 AND w.problem_id = p.id AND w.work IS NOT NULL
            ) AS has_work
     FROM last_attempt la
     JOIN problems p ON p.id = la.problem_id
     WHERE la.correct = false
     ORDER BY la.created_at DESC
     LIMIT $2`,
    [studentKey, Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows;
}

// 선생님용: 학생별 성적 요약
async function listStudentStats(limit = 100) {
  await ready;
  const { rows } = await pool.query(
    `SELECT a.student_key,
            (ARRAY_AGG(a.student_name ORDER BY a.created_at DESC) FILTER (WHERE a.student_name IS NOT NULL))[1] AS student_name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.correct)::int AS correct,
            MAX(a.created_at) AS last_solved_at
     FROM attempts a
     GROUP BY a.student_key
     ORDER BY MAX(a.created_at) DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows;
}

// 선생님용: 학생들이 많이 틀린 문제 순위(어떤 문제가 실제로 어려운지)
async function listHardestProblems(limit = 10) {
  await ready;
  const { rows } = await pool.query(
    `SELECT p.id, p.title, p.difficulty, p.unit,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.correct)::int AS correct
     FROM attempts a
     JOIN problems p ON p.id = a.problem_id
     GROUP BY p.id, p.title, p.difficulty, p.unit
     HAVING COUNT(*) >= 1
     ORDER BY (COUNT(*) FILTER (WHERE a.correct))::float / COUNT(*) ASC, COUNT(*) DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 10, 1), 50)]
  );
  return rows;
}

// 선생님용: 최근 N일간 일자별 풀이 수/정답 수
async function listDailyActivity(days = 14) {
  await ready;
  const span = Math.min(Math.max(Number(days) || 14, 1), 90);
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', a.created_at), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE a.correct)::int AS correct
     FROM attempts a
     WHERE a.created_at >= now() - ($1::text || ' days')::interval
     GROUP BY 1
     ORDER BY 1`,
    [String(span)]
  );
  return rows;
}

module.exports = {
  pool,
  DIFFICULTIES,
  QUESTION_TYPES,
  OBJECTIVE_CHOICES,
  listProblems,
  listUnits,
  getProblem,
  createProblem,
  updateProblem,
  deleteProblem,
  recordShowRound,
  listShowRounds,
  listUsedProblemIds,
  listRecentPrizes,
  recordAttempt,
  saveAttemptWork,
  getLatestWorkForProblem,
  listAttemptsWithWork,
  getAttemptWork,
  getStudentSummary,
  listRecentAttempts,
  listWrongProblems,
  listStudentStats,
  listHardestProblems,
  listDailyActivity,
};
