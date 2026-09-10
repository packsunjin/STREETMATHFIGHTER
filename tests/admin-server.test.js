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
