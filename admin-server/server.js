require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const cloudinary = require('cloudinary').v2;

const {
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
} = require('../shared/db');

const PORT = process.env.ADMIN_PORT || 4000;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-please-change';

if (!process.env.CLOUDINARY_URL) {
  throw new Error(
    'CLOUDINARY_URL 환경변수가 설정되지 않았습니다. .env에 무료 Cloudinary 계정의 연결 문자열을 넣어주세요.'
  );
}
cloudinary.config({ secure: true });

const { requireAuth } = require('./middleware/auth');

const app = express();

// Render 등 리버스 프록시 뒤에서 실행되므로, secure 쿠키 판별/레이트리밋 IP 확인이
// 프록시가 아니라 실제 클라이언트 기준으로 동작하게 함.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP는 인라인 스크립트가 없어질 때까지 보류
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// 관리자 페이지(정적 파일+API)는 항상 같은 오리진에서만 호출되므로 CORS는 필요 없고,
// 오히려 켜두면 다른 사이트가 관리자 세션 쿠키를 실어 API를 호출할 수 있어 위험함.
// (이전에 cors({ origin: true, credentials: true })로 아무 출처나 허용하고 있었음)
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    // 기본 MemoryStore는 메모리가 계속 쌓이고(누수) 재시작하면 로그인이 다 풀리는 데다
    // 서버 인스턴스가 여러 개면 세션 공유도 안 돼서, 이미 떠 있는 Postgres를 세션
    // 저장소로 재사용함(연결 정보 그대로, 새 DB를 따로 안 늘려도 됨).
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      // 전자칠판에 한 번 로그인해두면 학기 내내 유지되게 길게 잡는다.
      // 짧게 잡으면 하필 점심시간에 세션이 풀려서, 학생들 앞에서 로그인부터
      // 하고 있어야 한다. 기기가 강당에 고정돼 있고 쓰는 사람이 진행자
      // 한 명이라 이 길이가 실제 위험을 늘리지 않는다.
      maxAge: 1000 * 60 * 60 * 24 * 60, // 60일
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

// 로그인 무차별 대입 시도를 막기 위해 IP당 "틀린" 시도 횟수를 제한.
//
// 성공한 로그인까지 세면 안 된다. 학교는 전교생이 공인 IP 하나를 같이 쓰는
// 경우가 많아서, 제대로 로그인한 것만으로도 한도가 차서 정작 행사 진행자가
// 강당에서 잠기는 일이 생긴다. 무차별 대입은 "틀린" 시도로 이뤄지므로
// 실패만 세도 막는 효과는 그대로다.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '비밀번호를 너무 많이 틀렸습니다. 15분 뒤에 다시 시도해주세요.' },
});

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('이미지 파일(png, jpg, jpeg, gif, webp)만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});

// 업로드가 실패하는 이유는 대부분 Cloudinary 키가 잘못됐거나 용량 초과인데,
// 라이브러리 메시지("Server returned unexpected status code - 403")를 그대로
// 보여주면 선생님이 뭘 해야 하는지 알 수 없다. 사람이 읽을 문장으로 바꾼다.
class ImageUploadError extends Error {
  constructor(cause) {
    super('사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
    this.name = 'ImageUploadError';
    this.status = 502;
    this.cause = cause;
  }
}

function uploadImageToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'streetmathfighter', resource_type: 'image' },
      (err, result) => {
        if (err) return reject(new ImageUploadError(err));
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

// public 아래에 화면과 vendor(글꼴/애니메이션 라이브러리)가 같이 있다.
// 단독 실행이든 /admin 마운트든 같은 상대경로로 잡히도록 여기서만 서빙한다.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/stats', express.static(path.join(__dirname, 'admin-dashboard-app', 'dist')));

// 정답 문자열 정규화. 미입력이면 null(채점 기능 없음), 객관식이면 1~5만 허용.
function normalizeAnswer(questionType, rawAnswer) {
  if (rawAnswer === undefined || rawAnswer === null) return { ok: true, value: undefined };
  const trimmed = String(rawAnswer).trim();
  if (!trimmed) return { ok: true, value: null };
  if (questionType === 'objective' && !OBJECTIVE_CHOICES.includes(trimmed)) {
    return { ok: false };
  }
  return { ok: true, value: trimmed };
}

// 텍스트 필드 길이 제한: 특별한 제약이 없으면 관리자가 실수로(또는 악의적으로)
// 지나치게 긴 값을 넣어 DB/화면을 어지럽힐 수 있어 상식적인 상한선을 둠.
const FIELD_LIMITS = { title: 200, description: 5000, unit: 100, answer: 500 };

function validateFieldLengths(fields) {
  for (const [key, max] of Object.entries(FIELD_LIMITS)) {
    const value = fields[key];
    if (typeof value === 'string' && value.length > max) {
      return `${key}은(는) ${max}자를 넘을 수 없습니다.`;
    }
  }
  return null;
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

function parseId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: '올바르지 않은 문제 번호입니다.' });
  }
  req.problemId = id;
  next();
}

// ---- 인증 ----

app.post('/api/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.username = username;
    return res.json({ ok: true, username });
  }
  return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.isAdmin) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  return res.json({ authenticated: false });
});

// ---- 문제 관리 ----

function toPublicProblem(problem) {
  if (!problem) return null;
  return {
    id: problem.id,
    title: problem.title,
    difficulty: problem.difficulty,
    imageUrl: problem.image_path,
    description: problem.description,
    questionType: problem.question_type,
    answer: problem.answer,
    unit: problem.unit || null,
    createdAt: problem.created_at,
    updatedAt: problem.updated_at,
  };
}

app.get('/api/problems', requireAuth, async (req, res, next) => {
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

app.get('/api/units', requireAuth, async (req, res, next) => {
  try {
    const units = await listUnits({});
    res.json({ units });
  } catch (err) {
    next(err);
  }
});

app.get('/api/stats/problem-counts', requireAuth, async (req, res, next) => {
  try {
    const problems = await listProblems({});
    const byDifficulty = {};
    DIFFICULTIES.forEach((d) => (byDifficulty[d] = 0));
    const byUnitMap = new Map();

    problems.forEach((p) => {
      byDifficulty[p.difficulty] = (byDifficulty[p.difficulty] || 0) + 1;

      const unitKey = p.unit && p.unit.trim() ? p.unit.trim() : '(미분류)';
      if (!byUnitMap.has(unitKey)) {
        const counts = {};
        DIFFICULTIES.forEach((d) => (counts[d] = 0));
        byUnitMap.set(unitKey, counts);
      }
      byUnitMap.get(unitKey)[p.difficulty] += 1;
    });

    const byDifficultyList = DIFFICULTIES.map((difficulty) => ({
      difficulty,
      count: byDifficulty[difficulty],
    }));

    const byUnitList = Array.from(byUnitMap.entries()).map(([unit, counts]) => ({
      unit,
      ...counts,
      total: DIFFICULTIES.reduce((sum, d) => sum + counts[d], 0),
    }));
    byUnitList.sort((a, b) => b.total - a.total);

    res.json({ byDifficulty: byDifficultyList, byUnit: byUnitList, total: problems.length });
  } catch (err) {
    next(err);
  }
});

// 선생님용: 학생들이 실제로 어떻게 풀고 있는지(등록된 문제 수가 아니라 성취도)
// ---- 강당 라이브 이벤트(진행 화면) ----
// 진행 화면은 정답을 미리 알고 있어야 한다(타이머 끝나면 그 자리에서 공개).
// 그래서 이 API들은 전부 로그인한 진행자만 쓸 수 있다.

app.get('/api/show/problems', requireAuth, async (req, res, next) => {
  try {
    const difficulty = req.query.difficulty;
    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '올바르지 않은 난이도입니다.' });
    }

    const problems = await listProblems({ difficulty: difficulty || undefined });

    res.json({
      problems: problems
        .filter((p) => p.answer) // 정답이 없으면 쇼에서 쓸 수 없다
        .map((p) => ({
          id: p.id,
          title: p.title,
          difficulty: p.difficulty,
          unit: p.unit || null,
          imageUrl: p.image_path,
          questionType: p.question_type,
          answer: p.answer,
        })),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/problems/:id', requireAuth, parseId, async (req, res, next) => {
  try {
    const problem = await getProblem(req.problemId);
    if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/problems', requireAuth, upload.single('image'), async (req, res, next) => {
  try {
    const { title, difficulty, description, questionType, answer, unit } = req.body || {};

    if (!title || !title.trim()) {
      return res.status(400).json({ error: '제목을 입력해주세요.' });
    }
    if (!DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '난이도는 상/중/하 중 하나여야 합니다.' });
    }
    if (questionType && !QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({ error: '문제 유형이 올바르지 않습니다.' });
    }
    const normalizedAnswer = normalizeAnswer(questionType || 'subjective', answer);
    if (!normalizedAnswer.ok) {
      return res.status(400).json({ error: '객관식 정답은 ①~⑤ 중 하나를 선택해주세요.' });
    }
    const lengthError = validateFieldLengths({ title, description, unit, answer });
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }
    if (!req.file) {
      return res.status(400).json({ error: '문제 이미지를 업로드해주세요.' });
    }

    const uploaded = await uploadImageToCloudinary(req.file.buffer);

    const problem = await createProblem({
      title: title.trim(),
      difficulty,
      image_path: uploaded.secure_url,
      image_public_id: uploaded.public_id,
      description: description ? description.trim() : null,
      question_type: questionType || 'subjective',
      answer: normalizedAnswer.value,
      unit: unit ? unit.trim() : null,
    });

    res.status(201).json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.put('/api/problems/:id', requireAuth, parseId, upload.single('image'), async (req, res, next) => {
  try {
    const existing = await getProblem(req.problemId);
    if (!existing) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

    const { title, difficulty, description, questionType, answer, unit } = req.body || {};

    if (difficulty && !DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ error: '난이도는 상/중/하 중 하나여야 합니다.' });
    }
    if (questionType && !QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({ error: '문제 유형이 올바르지 않습니다.' });
    }
    const effectiveType = questionType || existing.question_type;
    const normalizedAnswer = normalizeAnswer(effectiveType, answer);
    if (!normalizedAnswer.ok) {
      return res.status(400).json({ error: '객관식 정답은 ①~⑤ 중 하나를 선택해주세요.' });
    }
    const lengthError = validateFieldLengths({ title, description, unit, answer });
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }

    let image_path;
    let image_public_id;
    if (req.file) {
      const uploaded = await uploadImageToCloudinary(req.file.buffer);
      image_path = uploaded.secure_url;
      image_public_id = uploaded.public_id;
      cloudinary.uploader.destroy(existing.image_public_id).catch(() => {});
    }

    const problem = await updateProblem(req.problemId, {
      title: title !== undefined ? title.trim() : undefined,
      difficulty: difficulty || undefined,
      image_path,
      image_public_id,
      description: description !== undefined ? description.trim() : undefined,
      question_type: questionType || undefined,
      answer: normalizedAnswer.value,
      unit: unit !== undefined ? unit.trim() : undefined,
    });

    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/problems/:id', requireAuth, parseId, async (req, res, next) => {
  try {
    const deleted = await deleteProblem(req.problemId);
    if (!deleted) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

    cloudinary.uploader.destroy(deleted.image_public_id).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 파일 업로드 관련 오류는 무엇을 고쳐야 하는지 알려줘야 의미가 있다.
const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: '사진 용량이 너무 큽니다. 더 작은 사진으로 올려주세요.',
  LIMIT_FILE_COUNT: '사진은 한 장만 올릴 수 있습니다.',
  LIMIT_UNEXPECTED_FILE: '예상하지 못한 파일이 들어왔습니다.',
};

app.use((err, req, res, next) => {
  console.error(err);

  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ error: MULTER_MESSAGES[err.code] || '파일을 처리할 수 없습니다.' });
  }

  // 우리가 직접 만든 오류만 메시지를 그대로 내보낸다.
  // 그 외에는 라이브러리/DB 내부 메시지가 브라우저로 새지 않도록 막는다.
  if (err instanceof ImageUploadError) {
    return res.status(err.status).json({ error: err.message });
  }

  res.status(500).json({ error: '요청을 처리할 수 없습니다. 잠시 후 다시 시도해주세요.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[admin-server] 관리자 서버 실행 중: http://localhost:${PORT}`);
  });

  function shutdown(signal) {
    console.log(`[admin-server] ${signal} 수신, 진행 중인 요청을 마저 처리하고 종료합니다...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
