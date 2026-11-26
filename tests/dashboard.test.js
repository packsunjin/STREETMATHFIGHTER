// 문제 관리 화면(dashboard.html)을 실제 브라우저로 돌려 본다. 크로미움이 없으면 건너뛴다.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

const db = require('../shared/db');
const adminApp = require('../admin-server/server');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  chromium = null;
}

let server;
let baseUrl;
let browser;
const createdIds = [];

before(async () => {
  if (!chromium) return;
  try {
    browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  } catch (err) {
    browser = null;
    return;
  }
  await new Promise((resolve) => {
    server = adminApp.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
});

after(async () => {
  for (const id of createdIds) await db.deleteProblem(id).catch(() => {});
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
});

async function login(t) {
  if (!browser) {
    t.skip('크로미움이 없어 브라우저 테스트를 건너뜀');
    return null;
  }
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl + 'index.html');
  await page.fill('#username', process.env.ADMIN_USERNAME);
  await page.fill('#password', process.env.ADMIN_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard\.html/);
  await page.waitForSelector('#problemList li');
  return { page, errors };
}

async function makeProblem(title, extra = {}) {
  const p = await db.createProblem({
    title: `[test-dash] ${title}`,
    difficulty: '하',
    image_path: '/problem-set/20.jpg',
    image_public_id: 'local:problem-set/20.jpg',
    question_type: 'subjective',
    answer: '462',
    ...extra,
  });
  createdIds.push(p.id);
  return p;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('숫자판으로 칠 수 없는 주관식 정답은 저장 전에 알려준다', async (t) => {
  await makeProblem('정답 형식');
  const ui = await login(t);
  if (!ui) return;
  await ui.page.fill('#answerText', '9분의 4');
  assert.match(await ui.page.textContent('#answerNote'), /숫자판으로 칠 수 없습니다/);
  await ui.page.fill('#answerText', '4/9');
  assert.doesNotMatch(await ui.page.textContent('#answerNote'), /칠 수 없습니다/);
  assert.deepEqual(ui.errors, []);
});

test('목록에서 출제를 끄면 진행 화면에서 빠지고, 다시 켜면 돌아온다', async (t) => {
  const p = await makeProblem('켜고 끄기');
  const ui = await login(t);
  if (!ui) return;
  const row = ui.page.locator('#problemList li', { hasText: '[test-dash] 켜고 끄기' });
  await row.locator('.btn-toggle').click();
  await row.locator('.badge.off').waitFor();
  assert.equal((await db.getProblem(p.id)).active, false);
  await row.locator('.btn-toggle').click();
  await ui.page.waitForFunction(
    (title) => ![...document.querySelectorAll('#problemList li')].some((li) => li.textContent.includes(title) && li.classList.contains('off')),
    '[test-dash] 켜고 끄기'
  );
  assert.equal((await db.getProblem(p.id)).active, true);
});

test('미리보기는 그 문제를 바로 풀이 화면에 띄운다(뺀 문제도)', async (t) => {
  const p = await makeProblem('미리보기');
  await db.setProblemActive(p.id, false);
  const ui = await login(t);
  if (!ui) return;
  const preview = ui.page; // 같은 로그인으로 연다
  await preview.goto(baseUrl + `show.html?preview=${p.id}`);
  await preview.waitForFunction(() => document.getElementById('solve').classList.contains('active'));
  assert.equal(await preview.textContent('#screenLabel'), '미리보기');
  assert.equal(await preview.textContent('#unitName'), '');
  await preview.keyboard.press('a');
  for (const ch of '462') await preview.keyboard.press(ch);
  await preview.keyboard.press('Enter');
  await preview.waitForFunction(() => document.getElementById('result').classList.contains('active'));
  assert.equal(await preview.textContent('#verdict'), '정답');
});

test('사진을 여러 장 넣으면 줄줄이 채워 한꺼번에 등록하고, 실패한 줄은 이유와 함께 남는다', async (t) => {
  const ui = await login(t);
  if (!ui) return;
  await ui.page.setInputFiles('#image', [
    { name: '문제A.png', mimeType: 'image/png', buffer: PNG },
    { name: '문제B.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await ui.page.locator('#bulkPanel').waitFor();
  assert.equal(await ui.page.textContent('#bulkCount'), '(2장)');
  const rows = ui.page.locator('.bulk-row');
  assert.equal(await rows.nth(0).locator('.b-title').inputValue(), '문제A');
  // 첫 줄은 정답을 비워 두고, 둘째 줄은 정답을 채운다(테스트 환경 Cloudinary는 가짜라 업로드가 실패한다)
  await rows.nth(1).locator('.b-answer').fill('12');
  await ui.page.click('#bulkSubmit');
  await ui.page.waitForFunction(() => [...document.querySelectorAll('.bulk-status')].every((s) => s.classList.contains('error')));
  assert.match(await rows.nth(0).locator('.bulk-status').textContent(), /숫자로/);
  assert.match(await rows.nth(1).locator('.bulk-status').textContent(), /사진 업로드에 실패/);
  assert.equal(await rows.count(), 2, '실패한 줄은 남아 있어야 함');
  await ui.page.click('#bulkClear');
  assert.equal(await ui.page.isHidden('#bulkPanel'), true);
});
