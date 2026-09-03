require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');

const { DIFFICULTIES, listProblems, getProblem } = require('../shared/db');

const PORT = process.env.MAIN_PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function toPublicProblem(problem) {
  if (!problem) return null;
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    imageUrl: problem.image_path,
    description: problem.description,
    questionType: problem.question_type,
    hasAnswer: Boolean(problem.answer),
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

// 정답은 목록/상세 조회 응답에는 절대 포함하지 않고, 학생이 답을 제출했을 때만
// 서버에서 직접 비교해서 채점 결과를 돌려준다 (프론트 소스에서 정답이 보이지 않도록).
app.post('/api/problems/:id/check', async (req, res, next) => {
  try {
    const problem = await getProblem(req.params.id);
    if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
    if (!problem.answer) {
      return res.status(400).json({ error: '채점 정보가 등록되지 않은 문제입니다.' });
    }

    const submitted = String(req.body?.answer ?? '').trim();
    const correctAnswer = problem.answer.trim();
    const correct =
      submitted.length > 0 &&
      (problem.question_type === 'objective'
        ? submitted === correctAnswer
        : submitted.toLowerCase() === correctAnswer.toLowerCase());

    res.json({ correct, correctAnswer });
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
