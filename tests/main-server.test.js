// 공개 사이트(오늘의 결과) 검증.
// 여기는 로그인이 없는 화면이라 "문제/정답이 새어나가지 않는가"가 핵심이다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const app = require('../main-server/server');

const createdProblemIds = [];
const createdRoundIds = [];

before(async () => {
  const problem = await db.createProblem({
    title: '[test-public] 공개 화면 문제',
    difficulty: '중',
    image_path: 'https://example.com/secret.png',
    image_public_id: 'fake-public',
    question_type: 'subjective',
    answer: '비밀정답42',
    unit: null,
  });
  createdProblemIds.push(problem.id);

  const win = await db.recordShowRound({
    problem_id: problem.id,
    problem_title: problem.title,
    difficulty: problem.difficulty,
    student_name: '2-1 박서준',
    correct: true,
    prize: '핫초코',
    duration_ms: 30000,
    work: { v: 1, strokes: [{ c: '#111', w: 0.004, e: 0, p: [0.1, 0.1, 0.2, 0.2] }] },
  });
  createdRoundIds.push(win.id);

  const loss = await db.recordShowRound({
    problem_id: problem.id,
    problem_title: problem.title,
    difficulty: problem.difficulty,
    student_name: '2-2 최유리',
    correct: false,
  });
  createdRoundIds.push(loss.id);
});

after(async () => {
  for (const id of createdRoundIds) {
    await db.pool.query('DELETE FROM show_rounds WHERE id = $1', [id]).catch(() => {});
  }
  for (const id of createdProblemIds) await db.deleteProblem(id).catch(() => {});
  await db.pool.end();
});

test('GET /healthz', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('오늘의 결과에는 정답자만 나오고, 도전 수는 전체를 센다', async () => {
  const res = await request(app).get('/api/today');
  assert.equal(res.status, 200);

  const names = res.body.winners.map((w) => w.name);
  assert.ok(names.includes('2-1 박서준'), '맞힌 학생은 나온다');
  assert.ok(!names.includes('2-2 최유리'), '틀린 학생은 정답자 목록에 없다');
  assert.ok(res.body.total >= 2, '도전 수에는 틀린 도전도 포함된다');
  assert.ok(res.body.wins >= 1);
});

test('공개 응답에 정답·사진·필기가 절대 실리지 않는다', async () => {
  const res = await request(app).get('/api/today');
  const body = JSON.stringify(res.body);

  assert.ok(!body.includes('비밀정답42'), '정답이 새면 안 된다');
  assert.ok(!body.includes('secret.png'), '문제 사진 주소가 새면 안 된다');
  assert.ok(!body.includes('strokes'), '필기 데이터가 새면 안 된다');

  const winner = res.body.winners.find((w) => w.name === '2-1 박서준');
  assert.deepEqual(Object.keys(winner).sort(), ['at', 'difficulty', 'name', 'prize', 'problemTitle']);
});

test('없어진 학생용 API는 더 이상 응답하지 않는다', async () => {
  // 개인 학습 기능을 걷어냈으므로 이 경로들이 살아 있으면 안 된다
  for (const path of ['/api/problems', '/api/units', '/api/me/summary', '/api/me/wrong']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404, `${path}는 없어야 함`);
  }
  const check = await request(app).post('/api/problems/1/check').send({ answer: '1' });
  assert.equal(check.status, 404);
});

test('보안 헤더(helmet)가 적용됨', async () => {
  const res = await request(app).get('/healthz');
  assert.ok(res.headers['x-content-type-options']);
});
