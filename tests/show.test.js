// 진행 화면이 쓰는 API 검증.
// 화면은 문제와 정답만 받아 간다. 남기는 기록은 없다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const adminApp = require('../admin-server/server');

const createdProblemIds = [];
let agent;
let problem;

async function makeProblem(overrides = {}) {
  const created = await db.createProblem({
    title: `[test-show] ${overrides.title || '문제'}`,
    difficulty: overrides.difficulty || '중',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-show',
    question_type: 'subjective',
    answer: overrides.answer ?? '42',
    unit: overrides.unit ?? null,
  });
  createdProblemIds.push(created.id);
  return created;
}

before(async () => {
  problem = await makeProblem({ title: '쇼 문제', answer: '42', unit: '등비수열' });
  agent = request.agent(adminApp);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
});

after(async () => {
  for (const id of createdProblemIds) await db.deleteProblem(id).catch(() => {});
  await db.pool.end();
});

test('진행 화면 API는 로그인해야 쓸 수 있다', async () => {
  // 정답을 그대로 내려주는 API라서 로그인 없이 열리면 안 된다
  const res = await request(adminApp).get('/api/show/problems');
  assert.equal(res.status, 401);
});

test('진행용 문제 목록에는 정답이 함께 온다(진행자가 그 자리에서 공개해야 하므로)', async () => {
  const res = await agent.get('/api/show/problems');
  assert.equal(res.status, 200);

  const mine = res.body.problems.find((p) => p.id === problem.id);
  assert.ok(mine, '방금 만든 문제가 목록에 있어야 함');
  assert.equal(mine.answer, '42');
  assert.equal(mine.unit, '등비수열');
  assert.ok(mine.imageUrl);
});

test('정답이 등록 안 된 문제는 진행 목록에서 빠진다', async () => {
  const noAnswer = await db.createProblem({
    title: '[test-show] 정답 없는 문제',
    difficulty: '중',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-show-2',
    question_type: 'subjective',
    answer: null,
    unit: null,
  });
  createdProblemIds.push(noAnswer.id);

  const res = await agent.get('/api/show/problems');
  assert.ok(!res.body.problems.some((p) => p.id === noAnswer.id));
});

test('난이도로 걸러진다', async () => {
  const res = await agent.get('/api/show/problems').query({ difficulty: '중' });
  assert.equal(res.status, 200);
  assert.ok(res.body.problems.every((p) => p.difficulty === '중'));
});

test('난이도가 이상하면 400', async () => {
  const res = await agent.get('/api/show/problems').query({ difficulty: '최상' });
  assert.equal(res.status, 400);
});

test('기록을 남기는 API는 더 이상 없다', async () => {
  // 풀고 상품 주면 끝이라, 서버에 쌓아두는 게 없어야 한다
  for (const path of ['/api/show/rounds', '/api/show/prizes', '/api/rounds', '/api/stats/students']) {
    const res = await agent.get(path);
    assert.equal(res.status, 404, `${path}는 없어야 함`);
  }
  const post = await agent.post('/api/show/rounds').send({ studentName: '아무개' });
  assert.equal(post.status, 404);
});
