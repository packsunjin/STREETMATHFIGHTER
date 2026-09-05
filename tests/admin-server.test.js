const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const app = require('../admin-server/server');

const createdIds = [];

async function makeProblem(overrides = {}) {
  const problem = await db.createProblem({
    title: `[test-admin] ${overrides.title || '샘플 문제'}`,
    difficulty: overrides.difficulty || '상',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-admin-id',
    description: overrides.description ?? null,
    question_type: overrides.question_type || 'subjective',
    answer: overrides.answer ?? '10',
    unit: overrides.unit ?? null,
  });
  createdIds.push(problem.id);
  return problem;
}

after(async () => {
  for (const id of createdIds) {
    await db.deleteProblem(id).catch(() => {});
  }
  await db.pool.end();
});

test('GET /healthz', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
});

test('로그인 안 하면 문제 API는 401', async () => {
  const res = await request(app).get('/api/problems');
  assert.equal(res.status, 401);
});

test('틀린 비밀번호로 로그인하면 401', async () => {
  const res = await request(app).post('/api/login').send({ username: 'admin', password: '틀린값' });
  assert.equal(res.status, 401);
});

test('CORS 헤더가 더 이상 임의의 출처를 반사하지 않음(취약점 수정 확인)', async () => {
  const res = await request(app)
    .post('/api/login')
    .set('Origin', 'http://evil.example.com')
    .send({ username: 'admin', password: '틀린값' });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('올바른 비밀번호로 로그인하면 세션이 생기고, 이후 인증 필요한 API를 쓸 수 있음', async () => {
  const agent = request.agent(app);
  const loginRes = await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  assert.equal(loginRes.status, 200);

  const meRes = await agent.get('/api/me');
  assert.equal(meRes.body.authenticated, true);

  const listRes = await agent.get('/api/problems');
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.problems));
});

test('문제 생성 -- 제목이 너무 길면 400(이미지 첨부 없이도 먼저 걸러짐)', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent
    .post('/api/problems')
    .field('title', 'a'.repeat(201))
    .field('difficulty', '상')
    .field('questionType', 'subjective');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /title/);
});

test(':id 검증 -- 잘못된 id는 인증된 요청이어도 400', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent.get('/api/problems/not-a-number');
  assert.equal(res.status, 400);
});

test('/api/stats/problem-counts -- 새로 추가한 문제만큼 정확히 증가함', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const before = await agent.get('/api/stats/problem-counts');
  const beforeTotal = before.body.total;
  const beforeHard = before.body.byDifficulty.find((d) => d.difficulty === '상').count;

  await makeProblem({ title: '통계 테스트1', difficulty: '상' });
  await makeProblem({ title: '통계 테스트2', difficulty: '상' });

  const afterRes = await agent.get('/api/stats/problem-counts');
  assert.equal(afterRes.body.total, beforeTotal + 2);
  assert.equal(afterRes.body.byDifficulty.find((d) => d.difficulty === '상').count, beforeHard + 2);
});

test('보안 헤더(helmet)가 적용됨', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
