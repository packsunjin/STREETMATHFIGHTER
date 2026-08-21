const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'data.sqlite');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('상', '중', '하')),
    image_path TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
`);

const DIFFICULTIES = ['상', '중', '하'];

function listProblems({ difficulty } = {}) {
  if (difficulty) {
    return db
      .prepare('SELECT * FROM problems WHERE difficulty = ? ORDER BY created_at DESC')
      .all(difficulty);
  }
  return db.prepare('SELECT * FROM problems ORDER BY created_at DESC').all();
}

function getProblem(id) {
  return db.prepare('SELECT * FROM problems WHERE id = ?').get(id);
}

function createProblem({ title, difficulty, image_path, description }) {
  const result = db
    .prepare(
      `INSERT INTO problems (title, difficulty, image_path, description)
       VALUES (@title, @difficulty, @image_path, @description)`
    )
    .run({ title, difficulty, image_path, description: description || null });
  return getProblem(result.lastInsertRowid);
}

function updateProblem(id, { title, difficulty, image_path, description }) {
  const existing = getProblem(id);
  if (!existing) return null;

  db.prepare(
    `UPDATE problems SET
       title = @title,
       difficulty = @difficulty,
       image_path = @image_path,
       description = @description,
       updated_at = datetime('now', 'localtime')
     WHERE id = @id`
  ).run({
    id,
    title: title ?? existing.title,
    difficulty: difficulty ?? existing.difficulty,
    image_path: image_path ?? existing.image_path,
    description: description !== undefined ? description : existing.description,
  });

  return getProblem(id);
}

function deleteProblem(id) {
  const existing = getProblem(id);
  if (!existing) return null;
  db.prepare('DELETE FROM problems WHERE id = ?').run(id);
  return existing;
}

module.exports = {
  db,
  DIFFICULTIES,
  listProblems,
  getProblem,
  createProblem,
  updateProblem,
  deleteProblem,
};
