// 문제 풀이 화면의 "손으로 쓰는" 핵심 동작을 실제 브라우저로 검증하는 회귀 테스트.
// 이 부분(펜이 사진 밖 여백에도 써지는지, 캔버스가 창 전체를 덮는지)은 창/사진 크기
// 로직을 건드릴 때마다 조용히 깨지기 쉬워서, 눈으로 확인하지 않아도 잡히도록 남겨둔다.
//
// playwright나 브라우저가 없는 환경에서는 자동으로 건너뛴다.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  chromium = null;
}

const db = require('../shared/db');
const app = require('../main-server/server');

// 외부 이미지 없이 테스트할 수 있도록 600x400 SVG를 data URI로 사용
const TEST_IMAGE =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
      '<rect width="600" height="400" fill="#fff" stroke="#000" stroke-width="3"/>' +
      '<text x="300" y="210" font-size="40" text-anchor="middle">1 + 1 = ?</text></svg>'
  ).toString('base64');

let server;
let baseUrl;
let browser;
let problem;

const skip = chromium ? false : 'playwright가 설치되어 있지 않아 건너뜀';

before(async () => {
  if (!chromium) return;
  problem = await db.createProblem({
    title: '[test-e2e] 필기 회귀 테스트',
    difficulty: '하',
    image_path: TEST_IMAGE,
    image_public_id: 'test-e2e',
    question_type: 'subjective',
    answer: '2',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (problem) await db.deleteProblem(problem.id).catch(() => {});
  await db.pool.end();
});

async function openSolvePage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/solve.html?id=${problem.id}`);
  await page.waitForFunction(() => document.getElementById('problemImage').naturalWidth > 0, null, {
    timeout: 10000,
  });
  // 등장 애니메이션과 크기 계산이 끝날 때까지 잠깐 기다림
  await page.waitForTimeout(1200);
  return { page, errors };
}

// 사진 기준 비율 좌표(fx, fy) 위치의 잉크 알파값. fx>1이면 사진 오른쪽 바깥(여백).
async function inkAt(page, fx, fy) {
  return page.evaluate(
    ([fx, fy]) => {
      const img = document.getElementById('problemImage').getBoundingClientRect();
      const c = document.getElementById('drawCanvas');
      const r = c.getBoundingClientRect();
      const dpr = c.width / r.width;
      const px = Math.round((img.left + fx * img.width - r.left) * dpr);
      const py = Math.round((img.top + fy * img.height - r.top) * dpr);
      if (px < 0 || py < 0 || px >= c.width || py >= c.height) return -1;
      return c.getContext('2d').getImageData(px, py, 1, 1).data[3];
    },
    [fx, fy]
  );
}

test('필기 캔버스가 창(canvas-frame) 전체를 정확히 덮는다', { skip }, async () => {
  const { page, errors } = await openSolvePage();
  const size = await page.evaluate(() => {
    const c = document.getElementById('drawCanvas').getBoundingClientRect();
    const f = document.getElementById('canvasFrame').getBoundingClientRect();
    return { cw: c.width, ch: c.height, fw: f.width, fh: f.height };
  });
  assert.ok(Math.abs(size.cw - size.fw) < 1, `캔버스 너비 ${size.cw} vs 창 너비 ${size.fw}`);
  assert.ok(Math.abs(size.ch - size.fh) < 1, `캔버스 높이 ${size.ch} vs 창 높이 ${size.fh}`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('창을 넓혀서 생긴 흰 여백에도 펜으로 써진다', { skip }, async () => {
  const { page, errors } = await openSolvePage();

  // 오른쪽 핸들을 끌어 사진 옆에 여백을 만든다
  const handle = await page.$('.resize-e');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const geo = await page.evaluate(() => {
    const i = document.getElementById('problemImage').getBoundingClientRect();
    const f = document.getElementById('canvasFrame').getBoundingClientRect();
    return { imgRight: i.right, imgTop: i.top, imgHeight: i.height, frameRight: f.right };
  });
  assert.ok(geo.frameRight - geo.imgRight > 100, '사진 오른쪽에 여백이 생겨야 함');

  // 여백 한가운데에 가로선 긋기
  const y = geo.imgTop + geo.imgHeight * 0.3;
  const x1 = geo.imgRight + 30;
  const x2 = geo.frameRight - 30;
  await page.mouse.move(x1, y);
  await page.mouse.down();
  await page.mouse.move(x2, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const midFx = ((x1 + x2) / 2 - (geo.imgRight - 600)) / 600; // 사진 폭 600 기준
  assert.ok(midFx > 1, '그은 위치가 사진 바깥(여백)이어야 함');

  const alpha = await inkAt(page, midFx, 0.3);
  assert.ok(alpha > 0, `여백에 그은 선이 실제로 그려져야 함 (alpha=${alpha})`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('되돌리기 버튼과 Ctrl+Z로 마지막 획을 취소한다', { skip }, async () => {
  const { page, errors } = await openSolvePage();

  const undoDisabled = () => page.evaluate(() => document.getElementById('undoBtn').disabled);
  const strokeCount = () => page.evaluate(() => strokes.length);

  assert.equal(await undoDisabled(), true, '처음에는 되돌릴 게 없어야 함');

  const g = await page.evaluate(() => {
    const r = document.getElementById('problemImage').getBoundingClientRect();
    return { l: r.left, t: r.top, w: r.width, h: r.height };
  });
  for (let i = 0; i < 2; i++) {
    const y = g.t + 80 + i * 60;
    await page.mouse.move(g.l + 40, y);
    await page.mouse.down();
    await page.mouse.move(g.l + 200, y + 15, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  assert.equal(await strokeCount(), 2);
  assert.equal(await undoDisabled(), false);

  await page.click('#undoBtn');
  await page.waitForTimeout(120);
  assert.equal(await strokeCount(), 1, '버튼으로 한 획 취소');

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(120);
  assert.equal(await strokeCount(), 0, 'Ctrl+Z로 나머지 한 획 취소');
  assert.equal(await undoDisabled(), true);

  assert.deepEqual(errors, []);
  await page.close();
});

test('문제 목록/상세 응답에 정답이 실려 오지 않는다(브라우저 기준)', { skip }, async () => {
  const { page } = await openSolvePage();
  const body = await page.evaluate(async (id) => {
    const res = await fetch(`/api/problems/${id}`);
    return res.json();
  }, problem.id);
  assert.equal('answer' in body.problem, false);
  await page.close();
});
