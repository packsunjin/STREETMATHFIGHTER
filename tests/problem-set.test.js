// 행사용 문제 묶음이 DB에 제대로 들어가는지.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const { PROBLEM_SET, applyProblemSet } = require('../shared/problem-set');
const adminApp = require('../admin-server/server');

after(async () => {
  await db.pool.end();
});

test('묶음의 사진이 전부 있고, 객관식 정답은 1~5다', () => {
  for (const p of PROBLEM_SET) {
    assert.ok(
      fs.existsSync(path.join(__dirname, '..', 'admin-server', 'public', 'problem-set', p.file)),
      `${p.file} 사진이 없음`
    );
    assert.ok(db.DIFFICULTIES.includes(p.difficulty));
    assert.ok(p.answer, `${p.file} 정답이 비어 있음`);
    if (p.type === 'objective') assert.ok(db.OBJECTIVE_CHOICES.includes(p.answer), p.file);
  }
});

test('기존 문제를 지우고 묶음으로 갈아끼운다. 같은 버전은 두 번 넣지 않는다', async () => {
  const old = await db.createProblem({
    title: '[test-set] 예전 문제',
    difficulty: '중',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-set',
    question_type: 'subjective',
    answer: '1',
  });

  const first = await applyProblemSet({ force: true });
  assert.equal(first.applied, true);
  assert.equal(first.inserted, PROBLEM_SET.length);
  assert.ok(first.removedPublicIds.includes('fake-set'), '지운 문제의 Cloudinary 사진을 알려줘야 함');
  assert.equal(await db.getProblem(old.id), null, '예전 문제는 지워져야 함');

  const rows = await db.listProblems();
  assert.equal(rows.length, PROBLEM_SET.length);

  // 관리 화면에서 하나 더 등록한 뒤 재시작해도 지워지지 않는다
  const added = await db.createProblem({
    title: '[test-set] 나중에 등록',
    difficulty: '하',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-set-2',
    question_type: 'subjective',
    answer: '3',
  });
  const second = await applyProblemSet();
  assert.equal(second.applied, false);
  assert.ok(await db.getProblem(added.id));
  await db.deleteProblem(added.id);
});

test('진행 화면이 묶음 문제와 사진을 받는다', async () => {
  const res = await request(adminApp).get('/api/show/problems');
  assert.equal(res.status, 200);
  assert.equal(res.body.problems.length, PROBLEM_SET.length);

  const photo = await request(adminApp).get(res.body.problems[0].imageUrl);
  assert.equal(photo.status, 200);
  assert.match(photo.headers['content-type'], /image\/jpeg/);
});
