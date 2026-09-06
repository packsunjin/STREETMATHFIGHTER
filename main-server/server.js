require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const {
  DIFFICULTIES,
  listProblems,
  listUnits,
  getProblem,
  recordAttempt,
  saveAttemptWork,
  getLatestWorkForProblem,
  getStudentSummary,
  listRecentAttempts,
  listWrongProblems,
} = require('../shared/db');

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

// ---- 학생이 사진 위에 쓴 풀이(획) ----
// 저장 형식은 용량을 아끼려고 짧은 키를 쓴다:
//   { v:1, strokes:[{ c: 색, w: 굵기(사진 폭 대비 비율), e: 지우개 여부, p:[x,y,x,y,...] }] }
// 좌표는 사진 기준 0~1 비율이고, 흰 여백에 쓴 획은 이 범위를 벗어날 수 있다(정상).
const WORK_LIMITS = {
  strokes: 3000,
  numbers: 120000, // 좌표 숫자 총개수 (= 점 6만 개)
  coord: 8, // 사진 크기의 8배를 넘어가는 좌표는 정상적인 필기가 아님
};
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** 받은 풀이를 검증하고, 저장해도 되는 형태로 정규화한다. 이상하면 null. */
function normalizeWork(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.strokes)) return null;
  if (raw.strokes.length === 0 || raw.strokes.length > WORK_LIMITS.strokes) return null;

  let numbers = 0;
  const strokes = [];
  for (const stroke of raw.strokes) {
    if (!stroke || typeof stroke !== 'object' || !Array.isArray(stroke.p)) return null;
    if (stroke.p.length < 2 || stroke.p.length % 2 !== 0) return null;

    numbers += stroke.p.length;
    if (numbers > WORK_LIMITS.numbers) return null;

    for (const value of stroke.p) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      if (Math.abs(value) > WORK_LIMITS.coord) return null;
    }

    const color = typeof stroke.c === 'string' && COLOR_RE.test(stroke.c) ? stroke.c : '#111111';
    const width = Number(stroke.w);
    if (!Number.isFinite(width) || width <= 0 || width > 1) return null;

    strokes.push({ c: color, w: width, e: stroke.e ? 1 : 0, p: stroke.p });
  }

  return { v: 1, strokes };
}

function parseId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '올바르지 않은 문제 번호입니다.' });
  }
  req.problemId = id;
  next();
}

// 학생 식별자는 브라우저가 만들어 보내는 값이라 형식을 좁게 제한한다
// (DB에 이상한 값이 쌓이거나 길이 폭탄이 들어오지 않도록).
function normalizeStudentKey(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return null;
  return key;
}

function normalizeStudentName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return name.slice(0, 20);
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

    // 학생 식별자가 같이 오면 풀이 기록을 남긴다(내 기록/오답 노트/선생님 통계용).
    // 기록이 실패하더라도 채점 결과는 정상적으로 돌려줘야 하므로 따로 감싼다.
    const studentKey = normalizeStudentKey(req.body?.studentKey);
    let attemptId = null;
    if (studentKey) {
      try {
        const attempt = await recordAttempt({
          problem_id: req.problemId,
          student_key: studentKey,
          student_name: normalizeStudentName(req.body?.studentName),
          correct,
          submitted_answer: submitted,
          duration_ms: Number(req.body?.durationMs),
        });
        attemptId = attempt?.id ?? null;
      } catch (recordErr) {
        console.error('풀이 기록 저장 실패:', recordErr);
      }
    }

    // attemptId를 돌려줘야 브라우저가 곧바로 필기 이미지를 이 시도에 붙일 수 있다.
    res.json({ correct, correctAnswer, attemptId });
  } catch (err) {
    next(err);
  }
});

// 필기는 본문이 커서(수십~수백 KB) 전역 100kb 제한과 따로, 이 라우트에만 넉넉한
// 한도를 준다. 채점 자체는 이미 끝난 뒤라 여기서 실패해도 점수에는 영향이 없다.
const workBodyParser = express.json({ limit: '600kb' });

const saveWorkLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

app.post('/api/attempts/:id/work', saveWorkLimiter, workBodyParser, async (req, res, next) => {
  try {
    const attemptId = Number(req.params.id);
    if (!Number.isInteger(attemptId) || attemptId <= 0) {
      return res.status(400).json({ error: '올바르지 않은 기록 번호입니다.' });
    }

    const studentKey = normalizeStudentKey(req.body?.studentKey);
    if (!studentKey) return res.status(400).json({ error: '학생 식별자가 필요합니다.' });

    const work = normalizeWork(req.body?.work);
    if (!work) return res.status(400).json({ error: '풀이 형식이 올바르지 않습니다.' });

    const saved = await saveAttemptWork(attemptId, studentKey, work);
    if (!saved) return res.status(404).json({ error: '기록을 찾을 수 없습니다.' });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/me/work', async (req, res, next) => {
  try {
    const studentKey = normalizeStudentKey(req.query.studentKey);
    if (!studentKey) return res.status(400).json({ error: '학생 식별자가 필요합니다.' });

    const problemId = Number(req.query.problemId);
    if (!Number.isInteger(problemId) || problemId <= 0) {
      return res.status(400).json({ error: '올바르지 않은 문제 번호입니다.' });
    }

    const attempt = await getLatestWorkForProblem(studentKey, problemId);
    if (!attempt) return res.json({ work: null });

    res.json({ work: attempt.work, correct: attempt.correct, createdAt: attempt.created_at });
  } catch (err) {
    next(err);
  }
});

// ---- 내 기록 / 오답 노트 ----
// 학생 로그인이 없는 서비스라 브라우저에 저장된 student_key로 본인을 구분한다.
// 남의 키를 알아야만 조회가 되므로 사실상 본인 기록만 보게 되고, 성적 외의
// 민감한 정보는 담지 않는다.

app.get('/api/me/summary', async (req, res, next) => {
  try {
    const studentKey = normalizeStudentKey(req.query.studentKey);
    if (!studentKey) return res.status(400).json({ error: '학생 식별자가 필요합니다.' });

    const [summary, recent] = await Promise.all([
      getStudentSummary(studentKey),
      listRecentAttempts(studentKey, 30),
    ]);

    // 최근 기록부터 연속으로 맞힌 개수
    let streak = 0;
    for (const attempt of recent) {
      if (!attempt.correct) break;
      streak += 1;
    }

    res.json({
      total: summary.total || 0,
      correct: summary.correct || 0,
      distinctProblems: summary.distinct_problems || 0,
      lastSolvedAt: summary.last_solved_at,
      streak,
      byDifficulty: summary.byDifficulty || [],
      recent: recent.slice(0, 10),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/me/wrong', async (req, res, next) => {
  try {
    const studentKey = normalizeStudentKey(req.query.studentKey);
    if (!studentKey) return res.status(400).json({ error: '학생 식별자가 필요합니다.' });

    const rows = await listWrongProblems(studentKey, 50);
    res.json({
      problems: rows.map((row) => ({
        id: row.id,
        title: row.title,
        difficulty: row.difficulty,
        unit: row.unit || null,
        imageUrl: row.image_path,
        questionType: row.question_type,
        lastTriedAt: row.last_tried_at,
        hasWork: row.has_work === true,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[main-server] 학생용 서버 실행 중: http://localhost:${PORT}`);
  });

  function shutdown(signal) {
    console.log(`[main-server] ${signal} 수신, 진행 중인 요청을 마저 처리하고 종료합니다...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
