const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const db = require('../shared/db');

const TEST_TITLE_PREFIX = '[test] ';
const createdIds = [];

async function makeProblem(overrides = {}) {
  const problem = await db.createProblem({
    title: `${TEST_TITLE_PREFIX}${overrides.title || '샘플 문제'}`,
    difficulty: overrides.difficulty || '상',
    image_path: 'https://example.com/fake.png',
    image_public_id: 'fake-public-id',
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

test('createProblem / getProblem 왕복', async () => {
  const created = await makeProblem({ title: '왕복 테스트', difficulty: '중', unit: '이차방정식' });
  const fetched = await db.getProblem(created.id);
  assert.equal(fetched.title, `${TEST_TITLE_PREFIX}왕복 테스트`);
  assert.equal(fetched.difficulty, '중');
  assert.equal(fetched.unit, '이차방정식');
});

test('listProblems가 difficulty로 필터링됨', async () => {
  const hard = await makeProblem({ title: '상 필터', difficulty: '상' });
  const easy = await makeProblem({ title: '하 필터', difficulty: '하' });

  const hardOnly = await db.listProblems({ difficulty: '상' });
  const ids = hardOnly.map((p) => p.id);
  assert.ok(ids.includes(hard.id), '상 난이도 문제가 포함되어야 함');
  assert.ok(!ids.includes(easy.id), '하 난이도 문제는 제외되어야 함');
});

test('listProblems가 unit으로도 필터링됨', async () => {
  const target = await makeProblem({ title: '단원 필터', unit: '등비수열' });
  const other = await makeProblem({ title: '다른 단원', unit: '미적분' });

  const filtered = await db.listProblems({ unit: '등비수열' });
  const ids = filtered.map((p) => p.id);
  assert.ok(ids.includes(target.id));
  assert.ok(!ids.includes(other.id));
});

test('listUnits가 등록된 unit 목록을 반환함(중복 없이)', async () => {
  await makeProblem({ title: '단원A-1', unit: '테스트단원A' });
  await makeProblem({ title: '단원A-2', unit: '테스트단원A' });

  const units = await db.listUnits({});
  const count = units.filter((u) => u === '테스트단원A').length;
  assert.equal(count, 1, 'DISTINCT라 한 번만 나와야 함');
});

test('updateProblem이 지정한 필드만 바꾸고 나머지는 유지함', async () => {
  const created = await makeProblem({ title: '수정 전', difficulty: '하', answer: '1' });
  const updated = await db.updateProblem(created.id, { title: `${TEST_TITLE_PREFIX}수정 후` });
  assert.equal(updated.title, `${TEST_TITLE_PREFIX}수정 후`);
  assert.equal(updated.difficulty, '하', '지정 안 한 필드는 그대로여야 함');
  assert.equal(updated.answer, '1');
});

test('deleteProblem이 삭제된 행을 반환하고, 이후 getProblem은 null', async () => {
  const created = await makeProblem({ title: '삭제될 문제' });
  const deleted = await db.deleteProblem(created.id);
  assert.equal(deleted.id, created.id);
  createdIds.splice(createdIds.indexOf(created.id), 1); // 이미 지웠으니 after 훅에서 또 안 지우게

  const fetched = await db.getProblem(created.id);
  assert.equal(fetched, null);
});

test('존재하지 않는 id로 getProblem 하면 null', async () => {
  const fetched = await db.getProblem(987654321);
  assert.equal(fetched, null);
});
