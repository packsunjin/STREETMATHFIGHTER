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

test('제대로 로그인하는 건 아무리 해도 안 막힌다', async () => {
  // 학교는 전교생이 공인 IP 하나를 같이 쓴다. 성공한 로그인까지 세면
  // 정작 진행자가 강당에서 잠긴다. 무차별 대입은 "틀린" 시도라서
  // 실패만 세도 막는 효과는 그대로다.
  for (let i = 0; i < 40; i += 1) {
    const res = await request(app)
      .post('/api/login')
      .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
    assert.equal(res.status, 200, `${i + 1}번째 정상 로그인이 막힘`);
  }
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
    .field('questionType', 'subjective')
    .field('answer', '10'); // 정답은 필수라, 제목 길이 검사에 닿으려면 채워야 한다
  assert.equal(res.status, 400);
  assert.match(res.body.error, /title/);
});

test(':id 검증 -- 잘못된 id는 인증된 요청이어도 400', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent.get('/api/problems/not-a-number');
  assert.equal(res.status, 400);
});

test('/api/stats/problem-counts -- 새로 추가한 문제가 집계에 들어간다', async () => {
  // 다른 테스트 파일도 같은 DB에 문제를 만들기 때문에 전체 개수를 정확히
  // 예측할 수는 없다. "최소한 내가 넣은 만큼은 늘었는가"로 확인한다.
  const agent = request.agent(app);
  await agent.post('/api/login').send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const before = await agent.get('/api/stats/problem-counts');
  const beforeTotal = before.body.total;
  const beforeHard = before.body.byDifficulty.find((d) => d.difficulty === '상').count;

  await makeProblem({ title: '통계 테스트1', difficulty: '상' });
  await makeProblem({ title: '통계 테스트2', difficulty: '상' });

  const afterRes = await agent.get('/api/stats/problem-counts');
  assert.ok(afterRes.body.total >= beforeTotal + 2, '전체 개수가 최소 2 늘어야 함');
  assert.ok(
    afterRes.body.byDifficulty.find((d) => d.difficulty === '상').count >= beforeHard + 2,
    '난이도 상이 최소 2 늘어야 함'
  );
  assert.equal(
    afterRes.body.byDifficulty.reduce((sum, d) => sum + d.count, 0),
    afterRes.body.total,
    '난이도별 합이 전체와 맞아야 함'
  );
});

test('보안 헤더(helmet)가 적용됨', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('정답 없이 등록하면 막힌다(정답 없는 문제는 진행 화면에서 사라진다)', async () => {
  // 예전에는 정답이 "선택"이라 그냥 등록됐고, 관리자 목록에만 보이고
  // 진행 화면에서는 아무 말 없이 빠졌다. 실제로 이것 때문에
  // "문제를 등록했는데 등록된 문제 없음으로 뜬다"가 났다.
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent
    .post('/api/problems')
    .field('title', '[test] 정답 없음')
    .field('difficulty', '중')
    .field('questionType', 'subjective')
    .field('answer', '')
    .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'x.png');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /정답/);
});

test('업로드가 실패해도 내부 오류 메시지가 브라우저로 새지 않는다', async () => {
  // 테스트 환경의 CLOUDINARY_URL은 가짜라 업로드가 반드시 실패한다.
  // 이때 "Server returned unexpected status code - 403" 같은 라이브러리 메시지가
  // 그대로 나가면 안 되고, 사람이 읽고 뭘 할지 아는 문장이어야 한다.
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent
    .post('/api/problems')
    .field('title', '[test] 업로드 실패')
    .field('difficulty', '중')
    .field('answer', '10') // 정답은 필수라, 업로드 단계까지 가려면 채워야 한다
    .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'x.png');

  assert.equal(res.status, 502);
  assert.equal(res.body.error, '사진 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
  assert.ok(!/403|status code|cloudinary/i.test(JSON.stringify(res.body)), '내부 정보가 없어야 함');
});

test('이미지가 아닌 파일을 올리면 무엇이 문제인지 400으로 알려준다', async () => {
  // 예전에는 확장자 검사 오류가 "요청을 처리할 수 없습니다"(500)로 바뀌어 나갔다.
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent
    .post('/api/problems')
    .field('title', '[test] 잘못된 파일')
    .field('difficulty', '중')
    .field('answer', '10')
    .attach('image', Buffer.from('hello'), 'notes.txt');

  assert.equal(res.status, 400);
  assert.match(res.body.error, /이미지 파일/);
});

test('수정에서 제목을 비우고 저장하면 막힌다', async () => {
  const problem = await makeProblem({ title: '제목 비우기' });
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const res = await agent.put(`/api/problems/${problem.id}`).field('title', '   ');
  assert.equal(res.status, 400);
  assert.equal((await db.getProblem(problem.id)).title, problem.title);
});

test('주관식 정답은 숫자판으로 칠 수 있어야 한다("9분의 4"는 막는다)', async () => {
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  const bad = await agent
    .post('/api/problems')
    .field('title', '[test] 한글 정답')
    .field('difficulty', '상')
    .field('questionType', 'subjective')
    .field('answer', '9분의 4')
    .attach('image', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'x.png');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /숫자판/);

  // 수정에서도 막는다. 분수·소수·음수는 된다.
  const problem = await makeProblem({ title: '정답 형식', answer: '10' });
  const badEdit = await agent.put(`/api/problems/${problem.id}`).field('answer', '③');
  assert.equal(badEdit.status, 400);
  for (const ok of ['3/4', '0.4', '-2']) {
    const res = await agent.put(`/api/problems/${problem.id}`).field('answer', ok);
    assert.equal(res.status, 200, `${ok}는 받아야 함`);
    assert.equal(res.body.problem.answer, ok);
  }
});

test('이번 행사에 낼지 켜고 끈다', async () => {
  const problem = await makeProblem({ title: '켜고 끄기' });
  const agent = request.agent(app);
  await agent
    .post('/api/login')
    .send({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });

  assert.equal((await request(app).patch(`/api/problems/${problem.id}/active`).send({ active: false })).status, 401);
  assert.equal((await agent.patch(`/api/problems/${problem.id}/active`).send({ active: 'no' })).status, 400);

  const off = await agent.patch(`/api/problems/${problem.id}/active`).send({ active: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.problem.active, false);
  const show = await request(app).get('/api/show/problems');
  assert.ok(!show.body.problems.some((p) => p.id === problem.id), '끈 문제는 진행 화면에 안 나와야 함');

  // 관리 목록에는 그대로 있다
  const list = await agent.get('/api/problems');
  assert.equal(list.body.problems.find((p) => p.id === problem.id).active, false);

  await agent.patch(`/api/problems/${problem.id}/active`).send({ active: true });
  const show2 = await request(app).get('/api/show/problems');
  assert.ok(show2.body.problems.some((p) => p.id === problem.id));
});

test('CSP가 켜져 있고 스크립트는 우리 서버 것만 허용한다', async () => {
  const res = await request(app).get('/show.html');
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'CSP 헤더가 있어야 함');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  // 진행 화면에 인라인 스크립트가 다시 생기면 CSP에 막혀 화면이 통째로 안 돈다
  assert.doesNotMatch(res.text, /<script>(?!\s*<\/script>)/);
});

test('문제 묶음 사진은 브라우저가 들고 있게 한다', async () => {
  const res = await request(app).get('/problem-set/01.jpg');
  assert.equal(res.status, 200);
  assert.match(res.headers['cache-control'], /max-age=86400/);
});
