require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');

const { DIFFICULTIES, listProblems, getProblem } = require('../shared/db');

const PORT = process.env.MAIN_PORT || 3000;

const app = express();

app.use(cors());
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

app.get('/api/problems', async (req, res, next) => {
  try {
    const { difficulty } = req.query;
    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
    }
    const problems = (await listProblems({ difficulty })).map(toPublicProblem);
    res.json({ problems });
  } catch (err) {
    next(err);
  }
});

app.get('/api/problems/:id', async (req, res, next) => {
  try {
    const problem = await getProblem(req.params.id);
    if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[main-server] 학생용 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
