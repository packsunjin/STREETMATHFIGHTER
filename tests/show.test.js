// 강당 라이브 이벤트(진행 화면) API 검증
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const adminApp = require('../admin-server/server');

const createdProblemIds = [];
const createdRoundIds = [];
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
  problem = await makeProblem({ title: '쇼 문제', answer: '42' });
  agent = request.agent(adminApp);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
});

after(async () => {
  // show_rounds는 문제가 지워져도 남으므로(ON DELETE SET NULL) 직접 지운다
  for (const id of createdRoundIds) {
    await db.pool.query('DELETE FROM show_rounds WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdProblemIds) await db.deleteProblem(id).catch(() => {});
  await db.pool.end();
});

test('진행 화면 API는 로그인해야 쓸 수 있다', async () => {
  // 정답을 그대로 내려주는 API라서 로그인 없이 열리면 안 된다
  for (const path of ['/api/show/problems', '/api/show/rounds', '/api/show/prizes']) {
    const res = await request(adminApp).get(path);
    assert.equal(res.status, 401, `${path}는 401이어야 함`);
  }
  const post = await request(adminApp).post('/api/show/rounds').send({ studentName: '침입자' });
  assert.equal(post.status, 401);
});

test('진행용 문제 목록에는 정답이 함께 온다(진행자가 그 자리에서 공개해야 하므로)', async () => {
  const res = await agent.get('/api/show/problems');
  assert.equal(res.status, 200);

  const mine = res.body.problems.find((p) => p.id === problem.id);
  assert.ok(mine, '방금 만든 문제가 목록에 있어야 함');
  assert.equal(mine.answer, '42');
  assert.equal(mine.used, false, '아직 안 쓴 문제');
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

test('난이도가 이상하면 400', async () => {
  const res = await agent.get('/api/show/problems').query({ difficulty: '최상' });
  assert.equal(res.status, 400);
});

test('라운드를 기록하면 목록과 상품 자동완성에 반영된다', async () => {
  const res = await agent.post('/api/show/rounds').send({
    problemId: problem.id,
    problemTitle: problem.title,
    difficulty: problem.difficulty,
    studentName: '2-3 김민수',
    correct: true,
    prize: '컵라면',
    durationMs: 45000,
  });
  assert.equal(res.status, 201);
  createdRoundIds.push(res.body.id);

  const rounds = await agent.get('/api/show/rounds');
  const mine = rounds.body.rounds.find((r) => r.id === res.body.id);
  assert.ok(mine);
  assert.equal(mine.studentName, '2-3 김민수');
  assert.equal(mine.correct, true);
  assert.equal(mine.prize, '컵라면');

  const prizes = await agent.get('/api/show/prizes');
  assert.ok(prizes.body.prizes.includes('컵라면'));
});

test('한 번 쓴 문제는 used로 표시돼서 같은 회차에 또 안 나온다', async () => {
  const res = await agent.get('/api/show/problems');
  const mine = res.body.problems.find((p) => p.id === problem.id);
  assert.equal(mine.used, true);
});

test('이름 없이 기록하려 하면 400', async () => {
  const res = await agent.post('/api/show/rounds').send({ correct: true });
  assert.equal(res.status, 400);
});

test('문제를 지워도 상 받은 기록은 남는다', async () => {
  const doomed = await makeProblem({ title: '곧 지울 문제', answer: '7' });
  const round = await agent.post('/api/show/rounds').send({
    problemId: doomed.id,
    problemTitle: doomed.title,
    difficulty: doomed.difficulty,
    studentName: '1-1 이영희',
    correct: true,
    prize: '초코파이',
  });
  createdRoundIds.push(round.body.id);

  await db.deleteProblem(doomed.id);

  const rounds = await agent.get('/api/show/rounds');
  const kept = rounds.body.rounds.find((r) => r.id === round.body.id);
  assert.ok(kept, '문제가 사라져도 기록은 남아야 함');
  assert.equal(kept.studentName, '1-1 이영희');
  assert.equal(kept.prize, '초코파이');
  assert.equal(kept.problemId, null, '문제 참조만 끊긴다');
  assert.equal(kept.problemTitle, doomed.title, '제목은 스냅샷으로 남아 있다');
});

test('이상한 필기 데이터는 저장하지 않되 라운드 기록은 남는다', async () => {
  // 행사 중에 필기 형식이 어긋났다고 "누가 상 받았는지"까지 날아가면 안 된다.
  const res = await agent.post('/api/show/rounds').send({
    problemId: problem.id,
    problemTitle: problem.title,
    studentName: '2-9 이상한필기',
    correct: true,
    prize: '사탕',
    work: { v: 1, strokes: [{ c: 'javascript:alert(1)', w: 999, p: ['a', 'b'] }] },
  });
  assert.equal(res.status, 201);
  createdRoundIds.push(res.body.id);

  const { rows } = await db.pool.query('SELECT work FROM show_rounds WHERE id = $1', [res.body.id]);
  assert.equal(rows[0].work, null, '이상한 필기는 저장하지 않는다');

  const rounds = await agent.get('/api/show/rounds');
  assert.ok(
    rounds.body.rounds.some((r) => r.id === res.body.id),
    '라운드 기록 자체는 남아야 함'
  );
});

test('정상 필기는 저장되고, 좌표 범위를 벗어나면 거부된다', async () => {
  const ok = await agent.post('/api/show/rounds').send({
    problemId: problem.id,
    studentName: '2-9 정상필기',
    correct: true,
    work: { v: 1, strokes: [{ c: '#e0393e', w: 0.004, e: 0, p: [0.1, 0.2, 0.3, 0.4] }] },
  });
  createdRoundIds.push(ok.body.id);

  const saved = await db.pool.query('SELECT work FROM show_rounds WHERE id = $1', [ok.body.id]);
  assert.equal(saved.rows[0].work.strokes.length, 1);
  assert.equal(saved.rows[0].work.strokes[0].c, '#e0393e');

  // 판 크기의 8배를 넘는 좌표는 정상적인 필기가 아니다
  const bad = await agent.post('/api/show/rounds').send({
    problemId: problem.id,
    studentName: '2-9 범위밖',
    correct: false,
    work: { v: 1, strokes: [{ c: '#111111', w: 0.004, p: [0, 0, 9999, 9999] }] },
  });
  createdRoundIds.push(bad.body.id);

  const rejected = await db.pool.query('SELECT work FROM show_rounds WHERE id = $1', [bad.body.id]);
  assert.equal(rejected.rows[0].work, null);
});
