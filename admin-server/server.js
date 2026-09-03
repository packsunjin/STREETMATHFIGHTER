require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { Readable } = require('stream');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;

const {
  DIFFICULTIES,
  QUESTION_TYPES,
  OBJECTIVE_CHOICES,
  listProblems,
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

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 8, // 8시간
      httpOnly: true,
    },
  })
);

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

function uploadImageToCloudinary(buffer) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: 'streetmathfighter', resource_type: 'image' },
      (err, result) => {
        if (err) return reject(err);
        resolve(result);
      }
    );
    Readable.from(buffer).pipe(uploadStream);
  });
}

app.use(express.static(path.join(__dirname, 'public')));

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

// ---- 인증 ----

app.post('/api/login', (req, res) => {
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

app.get('/api/problems/:id', requireAuth, async (req, res, next) => {
  try {
    const problem = await getProblem(req.params.id);
    if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/problems', requireAuth, upload.single('image'), async (req, res, next) => {
  try {
    const { title, difficulty, description, questionType, answer } = req.body || {};

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
    });

    res.status(201).json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.put('/api/problems/:id', requireAuth, upload.single('image'), async (req, res, next) => {
  try {
    const existing = await getProblem(req.params.id);
    if (!existing) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

    const { title, difficulty, description, questionType, answer } = req.body || {};

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

    let image_path;
    let image_public_id;
    if (req.file) {
      const uploaded = await uploadImageToCloudinary(req.file.buffer);
      image_path = uploaded.secure_url;
      image_public_id = uploaded.public_id;
      cloudinary.uploader.destroy(existing.image_public_id).catch(() => {});
    }

    const problem = await updateProblem(req.params.id, {
      title: title !== undefined ? title.trim() : undefined,
      difficulty: difficulty || undefined,
      image_path,
      image_public_id,
      description: description !== undefined ? description.trim() : undefined,
      question_type: questionType || undefined,
      answer: normalizedAnswer.value,
    });

    res.json({ problem: toPublicProblem(problem) });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/problems/:id', requireAuth, async (req, res, next) => {
  try {
    const deleted = await deleteProblem(req.params.id);
    if (!deleted) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

    cloudinary.uploader.destroy(deleted.image_public_id).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    console.error(err);
    return res.status(400).json({ error: err.message || '요청을 처리할 수 없습니다.' });
  }
  next(err);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[admin-server] 관리자 서버 실행 중: http://localhost:${PORT}`);
  });
}

module.exports = app;
