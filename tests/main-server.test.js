const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const db = require('../shared/db');
const app = require('../main-server/server');

const createdIds = [];
let objectiveProblem;
let subjectiveProblem;
let noAnswerProblem;

before(async () => {
  objectiveProblem = await db.createProblem({
    title: '[test] 객관식 문제',
    difficulty: '상',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-1',
    question_type: 'objective',
    answer: '3',
  });
  subjectiveProblem = await db.createProblem({
    title: '[test] 주관식 문제',
    difficulty: '중',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-2',
    question_type: 'subjective',
    answer: 'Answer', // 대소문자 무시 비교 확인용
  });
  noAnswerProblem = await db.createProblem({
    title: '[test] 채점 정보 없는 문제',
    difficulty: '하',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-3',
    question_type: 'subjective',
    answer: null,
  });
  createdIds.push(objectiveProblem.id, subjectiveProblem.id, noAnswerProblem.id);
});

after(async () => {
  for (const id of createdIds) {
    await db.deleteProblem(id).catch(() => {});
  }
  await db.pool.end();
});

test('GET /healthz', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('GET /api/problems -- 정답(answer) 필드가 절대 노출되지 않음', async () => {
  const res = await request(app).get('/api/problems');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.problems));
  const found = res.body.problems.find((p) => p.id === objectiveProblem.id);
  assert.ok(found, '방금 만든 문제가 목록에 있어야 함');
  assert.equal('answer' in found, false, 'answer 필드가 응답에 있으면 안 됨');
  assert.equal(found.hasAnswer, true);
});

test('GET /api/problems?difficulty=상 -- 유효하지 않은 난이도는 400', async () => {
  const res = await request(app).get('/api/problems').query({ difficulty: '최상' });
  assert.equal(res.status, 400);
});

test('GET /api/problems/:id -- 잘못된 id 형식은 400', async () => {
  const res = await request(app).get('/api/problems/not-a-number');
  assert.equal(res.status, 400);
});

test('GET /api/problems/:id -- 음수 id는 400', async () => {
  const res = await request(app).get('/api/problems/-5');
  assert.equal(res.status, 400);
});

test('GET /api/problems/:id -- 존재하지 않는 유효한 id는 404', async () => {
  const res = await request(app).get('/api/problems/999999999');
  assert.equal(res.status, 404);
});

test('GET /api/problems/:id -- 단일 조회에서도 answer 노출 안 됨', async () => {
  const res = await request(app).get(`/api/problems/${subjectiveProblem.id}`);
  assert.equal(res.status, 200);
  assert.equal('answer' in res.body.problem, false);
});

test('POST /api/problems/:id/check -- 객관식 정확히 일치해야 정답', async () => {
  const wrong = await request(app)
    .post(`/api/problems/${objectiveProblem.id}/check`)
    .send({ answer: '2' });
  assert.equal(wrong.body.correct, false);

  const right = await request(app)
    .post(`/api/problems/${objectiveProblem.id}/check`)
    .send({ answer: '3' });
  assert.equal(right.body.correct, true);
  assert.equal(right.body.correctAnswer, '3');
});

test('POST /api/problems/:id/check -- 주관식은 대소문자 무시하고 비교', async () => {
  const res = await request(app)
    .post(`/api/problems/${subjectiveProblem.id}/check`)
    .send({ answer: 'answer' });
  assert.equal(res.body.correct, true);
});

test('POST /api/problems/:id/check -- 빈 답은 오답 처리', async () => {
  const res = await request(app)
    .post(`/api/problems/${subjectiveProblem.id}/check`)
    .send({ answer: '' });
  assert.equal(res.body.correct, false);
});

test('POST /api/problems/:id/check -- 채점 정보 없는 문제는 400', async () => {
  const res = await request(app)
    .post(`/api/problems/${noAnswerProblem.id}/check`)
    .send({ answer: '아무거나' });
  assert.equal(res.status, 400);
});

test('POST /api/problems/:id/check -- 잘못된 id는 400', async () => {
  const res = await request(app).post('/api/problems/abc/check').send({ answer: '1' });
  assert.equal(res.status, 400);
});

test('보안 헤더(helmet)가 적용됨', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
