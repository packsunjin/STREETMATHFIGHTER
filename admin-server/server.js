require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const cors = require('cors');

const {
  DIFFICULTIES,
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
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('이미지 파일(png, jpg, jpeg, gif, webp)만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

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
    createdAt: problem.created_at,
    updatedAt: problem.updated_at,
  };
}

app.get('/api/problems', requireAuth, (req, res) => {
  const { difficulty } = req.query;
  if (difficulty && !DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: '난이도 값이 올바르지 않습니다.' });
  }
  const problems = listProblems({ difficulty }).map(toPublicProblem);
  res.json({ problems });
});

app.get('/api/problems/:id', requireAuth, (req, res) => {
  const problem = getProblem(req.params.id);
  if (!problem) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });
  res.json({ problem: toPublicProblem(problem) });
});

app.post('/api/problems', requireAuth, upload.single('image'), (req, res) => {
  const { title, difficulty, description } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '제목을 입력해주세요.' });
  }
  if (!DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: '난이도는 상/중/하 중 하나여야 합니다.' });
  }
  if (!req.file) {
    return res.status(400).json({ error: '문제 이미지를 업로드해주세요.' });
  }

  const problem = createProblem({
    title: title.trim(),
    difficulty,
    image_path: `/uploads/${req.file.filename}`,
    description: description ? description.trim() : null,
  });

  res.status(201).json({ problem: toPublicProblem(problem) });
});

app.put('/api/problems/:id', requireAuth, upload.single('image'), (req, res) => {
  const existing = getProblem(req.params.id);
  if (!existing) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

  const { title, difficulty, description } = req.body || {};

  if (difficulty && !DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ error: '난이도는 상/중/하 중 하나여야 합니다.' });
  }

  let image_path;
  if (req.file) {
    image_path = `/uploads/${req.file.filename}`;
    const oldFile = path.join(UPLOAD_DIR, path.basename(existing.image_path));
    fs.unlink(oldFile, () => {});
  }

  const problem = updateProblem(req.params.id, {
    title: title !== undefined ? title.trim() : undefined,
    difficulty: difficulty || undefined,
    image_path,
    description: description !== undefined ? description.trim() : undefined,
  });

  res.json({ problem: toPublicProblem(problem) });
});

app.delete('/api/problems/:id', requireAuth, (req, res) => {
  const deleted = deleteProblem(req.params.id);
  if (!deleted) return res.status(404).json({ error: '문제를 찾을 수 없습니다.' });

  const filePath = path.join(UPLOAD_DIR, path.basename(deleted.image_path));
  fs.unlink(filePath, () => {});

  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

app.listen(PORT, () => {
  console.log(`[admin-server] 관리자 서버 실행 중: http://localhost:${PORT}`);
});
