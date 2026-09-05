require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { DIFFICULTIES, listProblems, listUnits, getProblem } = require('../shared/db');

const PORT = process.env.MAIN_PORT || 3000;

const app = express();

// Render 등 리버스 프록시 뒤에서 실행되므로, req.ip가 프록시 IP가 아니라
// 실제 클라이언트 IP를 가리키게 함(레이트리밋이 IP별로 정확히 동작하려면 필요).
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP는 인라인 스크립트가 없어질 때까지 보류
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// 정답 제출은 무차별 대입으로 답을 알아낼 수 있는 엔드포인트라 IP당 빈도를 제한한다.
const checkAnswerLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

function parseId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '올바르지 않은 문제 번호입니다.' });
  }
  req.problemId = id;
  next();
}

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
    unit: problem.unit || null,
  };
}

app.get('/api/problems', async (req, res, next) => {
  try {
    const { difficulty, unit } = req.query;
    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
    }
    const problems = (await listProblems({ difficulty, unit })).map(toPublicProblem);
    res.json({ problems });
  } catch (err) {
    next(err);
  }
});

app.get('/api/units', async (req, res, next) => {
  try {
    const { difficulty } = req.query;
    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
    }
    const units = await listUnits({ difficulty });
    res.json({ units });
  } catch (err) {
    next(err);
  }
});

app.get('/api/problems/:id', parseId, async (req, res, next) => {
  try {
    const problem = await getProblem(req.problemId);
    if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

// 정답은 목록/상세 조회 응답에는 절대 포함하지 않고, 학생이 답을 제출했을 때만
// 서버에서 직접 비교해서 채점 결과를 돌려준다 (프론트 소스에서 정답이 보이지 않도록).
app.post('/api/problems/:id/check', parseId, checkAnswerLimiter, async (req, res, next) => {
  try {
    const problem = await getProblem(req.problemId);
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
