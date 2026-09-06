// 공개 진입점. 학생용 화면은 없고, 들어온 사람을 진행 화면으로 보내기만 한다.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const app = require('../main-server/server');

after(async () => {
  await db.pool.end();
});

test('GET /healthz', async () => {
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('루트는 진행 화면으로 안내한다', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/admin\/show\.html/);
});

test('로그인 없이 열리는 API는 하나도 없다', async () => {
  // 문제도 정답도 기록도 여기서는 안 나간다
  for (const path of ['/api/today', '/api/problems', '/api/units', '/api/me/summary']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 404, `${path}는 없어야 함`);
  }
});

test('보안 헤더(helmet)가 적용됨', async () => {
  const res = await request(app).get('/healthz');
  assert.ok(res.headers['x-content-type-options']);
});
