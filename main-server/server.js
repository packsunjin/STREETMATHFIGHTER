require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { DIFFICULTIES, listProblems, getProblem } = require('../shared/db');

const PORT = process.env.MAIN_PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();

app.use(cors());
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

function toPublicProblem(problem) {
  if (!problem) return null;
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    imageUrl: problem.image_path,
    description: problem.description,
  };
}

app.get('/api/problems', (req, res) => {
  const { difficulty } = req.query;
  if (difficulty && !DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
  }
  const problems = listProblems({ difficulty }).map(toPublicProblem);
  res.json({ problems });
});

app.get('/api/problems/:id', (req, res) => {
  const problem = getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
  res.json({ problem: toPublicProblem(problem) });
});

app.listen(PORT, () => {
  console.log(`[main-server] 학생용 서버 실행 중: http://localhost:${PORT}`);
});
