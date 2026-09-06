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

  -- 강당 라이브 이벤트의 라운드 기록(한 학생이 한 문제에 도전한 결과).
  -- 문제를 나중에 지워도 이 기록은 남아야 한다. 누가 무슨 상을 받았는지는 사실
  -- 기록이라 문제 삭제로 사라지면 안 되기 때문 -> ON DELETE SET NULL + 제목 스냅샷.
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

// ---- 선생님용 통계 ----
// 전부 라이브 이벤트 기록(show_rounds) 기준이다. 이 앱에서 "성적"은
// 강당에서 도전해서 맞혔는지 뿐이라, 학생 구분도 진행자가 부른 이름으로 한다.

// 학생별 도전 횟수와 정답률
async function listStudentStats(limit = 100) {
  await ready;
  const { rows } = await pool.query(
    `SELECT student_name,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE correct)::int AS correct,
            COUNT(*) FILTER (WHERE correct AND prize IS NOT NULL AND prize <> '')::int AS prizes,
            MAX(created_at) AS last_solved_at
     FROM show_rounds
     GROUP BY student_name
     ORDER BY MAX(created_at) DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
  return rows;
}

// 실제로 아무도 못 맞힌 문제 순위. 다음에 낼 문제를 고를 때 쓴다.
// 문제가 지워졌을 수 있으므로 problems가 아니라 기록에 남은 제목을 기준으로 묶는다.
async function listHardestProblems(limit = 10) {
  await ready;
  const { rows } = await pool.query(
    `SELECT MIN(problem_id) AS id,
            problem_title AS title,
            MIN(difficulty) AS difficulty,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE correct)::int AS correct
     FROM show_rounds
     WHERE problem_title IS NOT NULL
     GROUP BY problem_title
     ORDER BY (COUNT(*) FILTER (WHERE correct))::float / COUNT(*) ASC, COUNT(*) DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 10, 1), 50)]
  );
  return rows;
}

// 날짜별 도전/성공 수 (행사를 며칠 했고 반응이 어땠는지)
async function listDailyActivity(days = 14) {
  await ready;
  const span = Math.min(Math.max(Number(days) || 14, 1), 90);
  const { rows } = await pool.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE correct)::int AS correct
     FROM show_rounds
     WHERE created_at >= now() - ($1::text || ' days')::interval
     GROUP BY 1
     ORDER BY 1`,
    [String(span)]
  );
  return rows;
}

// 학생이 칠판에 실제로 쓴 풀이를 다시 보기 위한 목록/단건 조회.
// 목록에는 획 데이터를 싣지 않는다(한 건이 수십 KB라 목록이 무거워진다).
async function listRoundsWithWork({ studentName, limit = 30 } = {}) {
  await ready;
  const conditions = ['work IS NOT NULL'];
  const values = [];
  if (studentName) {
    values.push(studentName);
    conditions.push(`student_name = $${values.length}`);
  }
  values.push(Math.min(Math.max(Number(limit) || 30, 1), 100));

  const { rows } = await pool.query(
    `SELECT id, problem_id, problem_title, difficulty, student_name,
            correct, prize, duration_ms, created_at
     FROM show_rounds
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return rows;
}

async function getRoundWork(roundId) {
  await ready;
  const { rows } = await pool.query(
    `SELECT r.id, r.problem_id, r.problem_title, r.difficulty, r.student_name,
            r.correct, r.prize, r.duration_ms, r.created_at, r.work,
            p.image_path
     FROM show_rounds r
     LEFT JOIN problems p ON p.id = r.problem_id
     WHERE r.id = $1`,
    [roundId]
  );
  return rows[0] || null;
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
  listRoundsWithWork,
  getRoundWork,
  listStudentStats,
  listHardestProblems,
  listDailyActivity,
};
