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
};
