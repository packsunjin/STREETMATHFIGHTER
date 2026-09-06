// 학생 풀이 기록(내 기록 / 오답 노트 / 선생님용 성취도) 검증
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const mainApp = require('../main-server/server');
const adminApp = require('../admin-server/server');

const STUDENT = 'test-student-key-0001';
const OTHER_STUDENT = 'test-student-key-0002';
const createdIds = [];

async function makeProblem(overrides = {}) {
  const problem = await db.createProblem({
    title: `[test-attempt] ${overrides.title || '문제'}`,
    difficulty: overrides.difficulty || '중',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-attempt',
    question_type: 'subjective',
    answer: overrides.answer ?? '10',
    unit: overrides.unit ?? null,
  });
  createdIds.push(problem.id);
  return problem;
}

async function submit(problemId, answer, studentKey = STUDENT, extra = {}) {
  return request(mainApp)
    .post(`/api/problems/${problemId}/check`)
    .send({ answer, studentKey, studentName: '테스트학생', ...extra });
}

let wrongProblem;
let rightProblem;

before(async () => {
  wrongProblem = await makeProblem({ title: '틀릴 문제', answer: '10' });
  rightProblem = await makeProblem({ title: '맞힐 문제', answer: '20' });

  await submit(wrongProblem.id, '999', STUDENT, { durationMs: 12345 });
  await submit(rightProblem.id, '20', STUDENT);
});

after(async () => {
  // attempts는 problem 삭제 시 ON DELETE CASCADE로 같이 지워짐
  for (const id of createdIds) await db.deleteProblem(id).catch(() => {});
  await db.pool.end();
});

test('채점하면 풀이 기록이 남고 내 기록 요약에 반영된다', async () => {
  const res = await request(mainApp).get('/api/me/summary').query({ studentKey: STUDENT });
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.correct, 1);
  assert.equal(res.body.streak, 1, '가장 최근에 맞혔으므로 연속 정답 1');
  assert.ok(Array.isArray(res.body.recent));
});

test('학생 식별자가 없으면 400', async () => {
  const res = await request(mainApp).get('/api/me/summary');
  assert.equal(res.status, 400);
});

test('형식이 이상한 학생 식별자는 기록되지 않는다', async () => {
  const problem = await makeProblem({ title: '이상한 키', answer: '1' });
  await request(mainApp)
    .post(`/api/problems/${problem.id}/check`)
    .send({ answer: '1', studentKey: '짧음' }); // 형식 불일치 -> 기록 안 됨

  const res = await request(mainApp).get('/api/me/summary').query({ studentKey: '짧음' });
  assert.equal(res.status, 400, '유효하지 않은 키는 조회 자체가 거부됨');
});

test('오답 노트에는 마지막 시도가 틀린 문제만 들어간다', async () => {
  const res = await request(mainApp).get('/api/me/wrong').query({ studentKey: STUDENT });
  assert.equal(res.status, 200);
  const ids = res.body.problems.map((p) => p.id);
  assert.ok(ids.includes(wrongProblem.id), '틀린 문제는 포함');
  assert.ok(!ids.includes(rightProblem.id), '맞힌 문제는 제외');
});

test('다시 풀어서 맞히면 오답 노트에서 빠진다', async () => {
  await submit(wrongProblem.id, '10'); // 이번엔 정답

  const res = await request(mainApp).get('/api/me/wrong').query({ studentKey: STUDENT });
  const ids = res.body.problems.map((p) => p.id);
  assert.ok(!ids.includes(wrongProblem.id));

  const summary = await request(mainApp).get('/api/me/summary').query({ studentKey: STUDENT });
  assert.equal(summary.body.total, 3);
  assert.equal(summary.body.correct, 2);
  assert.equal(summary.body.streak, 2, '연속으로 두 번 맞힘');
});

test('다른 학생의 기록은 섞이지 않는다', async () => {
  await submit(rightProblem.id, '20', OTHER_STUDENT);

  const mine = await request(mainApp).get('/api/me/summary').query({ studentKey: STUDENT });
  const theirs = await request(mainApp).get('/api/me/summary').query({ studentKey: OTHER_STUDENT });
  assert.equal(mine.body.total, 3);
  assert.equal(theirs.body.total, 1);
});

test('선생님용 학생 성취도 통계는 로그인해야 볼 수 있다', async () => {
  const res = await request(adminApp).get('/api/stats/students');
  assert.equal(res.status, 401);
});

test('선생님용 통계에 학생별 정답률과 어려운 문제 순위가 나온다', async () => {
  const agent = request.agent(adminApp);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent.get('/api/stats/students');
  assert.equal(res.status, 200);

  const me = res.body.students.find((s) => s.studentKey === STUDENT);
  assert.ok(me, '방금 푼 학생이 목록에 있어야 함');
  assert.equal(me.total, 3);
  assert.equal(me.correct, 2);
  assert.equal(me.accuracy, 67);

  assert.ok(Array.isArray(res.body.hardestProblems));
  assert.ok(Array.isArray(res.body.dailyActivity));
});
