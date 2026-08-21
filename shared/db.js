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

const DIFFICULTIES = ['상', '중', '하'];

const ready = pool.query(`
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
`);

async function listProblems({ difficulty } = {}) {
  await ready;
  if (difficulty) {
    const { rows } = await pool.query(
      'SELECT * FROM problems WHERE difficulty = $1 ORDER BY created_at DESC',
      [difficulty]
    );
    return rows;
  }
  const { rows } = await pool.query('SELECT * FROM problems ORDER BY created_at DESC');
  return rows;
}

async function getProblem(id) {
  await ready;
  const { rows } = await pool.query('SELECT * FROM problems WHERE id = $1', [id]);
  return rows[0] || null;
}

async function createProblem({ title, difficulty, image_path, image_public_id, description }) {
  await ready;
  const { rows } = await pool.query(
    `INSERT INTO problems (title, difficulty, image_path, image_public_id, description)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [title, difficulty, image_path, image_public_id, description || null]
  );
  return rows[0];
}

async function updateProblem(id, { title, difficulty, image_path, image_public_id, description }) {
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
       updated_at = now()
     WHERE id = $6
     RETURNING *`,
    [
      title ?? existing.title,
      difficulty ?? existing.difficulty,
      image_path ?? existing.image_path,
      image_public_id ?? existing.image_public_id,
      description !== undefined ? description : existing.description,
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
  listProblems,
  getProblem,
  createProblem,
  updateProblem,
  deleteProblem,
};
