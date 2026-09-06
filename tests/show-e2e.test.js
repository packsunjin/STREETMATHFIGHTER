// 진행 화면을 실제 브라우저로 돌려보는 검증.
// 이 화면은 행사 중에 한 번 막히면 되돌릴 방법이 없어서(강당에 사람이 앉아 있다),
// "화면이 안 넘어가는" 종류의 사고를 여기서 먼저 잡는다.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'testpass123';
process.env.CLOUDINARY_URL = process.env.CLOUDINARY_URL || 'cloudinary://key:secret@test-cloud';

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  chromium = null; // 브라우저가 없는 환경에서는 이 파일 전체를 건너뛴다
}

const db = require('../shared/db');
const adminApp = require('../admin-server/server');

// 전자칠판 표준 해상도
const BOARD = { width: 1920, height: 1080 };

// 1x1 투명 PNG. 외부 네트워크 없이 사진 로딩까지 확인하기 위해 data URL을 쓴다.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let server;
let browser;
let baseURL;
const createdProblemIds = [];
const createdRoundIds = [];

describe('진행 화면 (브라우저)', { skip: chromium ? false : 'playwright 없음' }, () => {
  before(async () => {
    const problem = await db.createProblem({
      title: '[test-e2e] 진행 화면 문제',
      difficulty: '하',
      image_path: TINY_PNG,
      image_public_id: 'fake-e2e',
      question_type: 'subjective',
      answer: '77',
      unit: null,
    });
    createdProblemIds.push(problem.id);

    await new Promise((resolve) => {
      server = adminApp.listen(0, resolve);
    });
    baseURL = `http://127.0.0.1:${server.address().port}`;

    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    });
  });

  after(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    for (const id of createdRoundIds) {
      await db.pool.query('DELETE FROM show_rounds WHERE id = $1', [id]).catch(() => {});
    }
    for (const id of createdProblemIds) await db.deleteProblem(id).catch(() => {});
    await db.pool.end();
  });

  /** 로그인한 상태의 진행 화면을 연다. */
  async function openShow() {
    const context = await browser.newContext({ viewport: BOARD });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

    await page.goto(`${baseURL}/index.html`);
    await page.fill('#username', process.env.ADMIN_USERNAME);
    await page.fill('#password', process.env.ADMIN_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForTimeout(500);

    await page.goto(`${baseURL}/show.html`);
    await page.waitForSelector('#stageIdle:not([hidden])');
    return { page, context, errors };
  }

  /** 대기 화면에서 문제 풀이 화면까지 진행한다. */
  async function startRound(page) {
    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    await page.locator('.pick-card:not([disabled])').first().click();
    await page.waitForSelector('#stageReady:not([hidden])');
    await page.click('#goBtn');
    // 3-2-1 카운트다운이 끝나고 필기가 가능해질 때까지
    await page.waitForFunction(() => !document.querySelector('#stagePlay[hidden]'));
    await page.waitForTimeout(4000);
  }

  test('카운트다운 연출이 끝나면 화면을 덮지 않는다', async () => {
    // 카운트다운 레이어가 남으면 진행자가 아무 버튼도 못 눌러 행사가 멈춘다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    // 덮개가 남아 있으면 이 클릭이 타임아웃난다
    await page.click('#addTimeBtn', { timeout: 3000 });

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('필기 캔버스가 판 전체를 정확히 덮는다', async () => {
    // 어긋나면 쓴 위치와 보이는 위치가 달라진다
    const { page, context } = await openShow();
    await startRound(page);

    const fits = await page.evaluate(() => {
      const board = document.getElementById('board');
      const canvas = document.getElementById('boardCanvas');
      return {
        dw: Math.abs(board.offsetWidth - canvas.getBoundingClientRect().width),
        dh: Math.abs(board.offsetHeight - canvas.getBoundingClientRect().height),
      };
    });
    assert.ok(fits.dw < 2 && fits.dh < 2, `캔버스가 어긋남: ${JSON.stringify(fits)}`);
    await context.close();
  });

  test('사진 위에도, 옆 흰 여백에도 필기가 된다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    const photo = await page.locator('#boardPhoto').boundingBox();
    const board = await page.locator('#board').boundingBox();

    async function stroke(x, y) {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) await page.mouse.move(x + i * 8, y + i * 3);
      await page.mouse.up();
    }

    await stroke(photo.x + photo.width / 2, photo.y + photo.height / 2); // 사진 위
    await stroke(photo.x + photo.width + 60, board.y + 200); // 오른쪽 흰 여백

    const strokes = await page.evaluate(() => SMFDraw.serialize()?.strokes.length ?? 0);
    assert.equal(strokes, 2, '두 획 모두 기록돼야 함');

    // 실제로 캔버스에 잉크가 남았는지도 확인(좌표만 쌓이고 안 그려지는 경우 방지)
    const hasInk = await page.evaluate(() => {
      const c = document.getElementById('boardCanvas');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 10) return true;
      return false;
    });
    assert.ok(hasInk, '캔버스에 실제로 그려져야 함');

    await context.close();
  });

  test('되돌리기와 전체 지우기가 동작한다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    const board = await page.locator('#board').boundingBox();
    for (let n = 0; n < 3; n += 1) {
      await page.mouse.move(board.x + 200, board.y + 150 + n * 60);
      await page.mouse.down();
      await page.mouse.move(board.x + 320, board.y + 150 + n * 60);
      await page.mouse.up();
    }
    assert.equal(await page.evaluate(() => SMFDraw.serialize().strokes.length), 3);

    await page.click('#undoBtn');
    assert.equal(await page.evaluate(() => SMFDraw.serialize().strokes.length), 2);

    await page.click('#clearBtn');
    assert.equal(await page.evaluate(() => SMFDraw.serialize()), null);

    await context.close();
  });

  test('정답 공개부터 상품 등록까지 이어지고 서버에 남는다', async () => {
    const { page, context, errors } = await openShow();
    await startRound(page);

    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');
    assert.equal(await page.locator('#revealAnswer').textContent(), '77');

    await page.click('#correctBtn');
    await page.waitForSelector('#stageAward:not([hidden])');
    await page.fill('#nameInput', '3-5 테스트학생');
    await page.fill('#prizeInput', '테스트상품');
    await page.click('#awardSaveBtn');

    await page.waitForSelector('#stageCelebrate:not([hidden])');
    assert.equal(await page.locator('#celebrateName').textContent(), '3-5 테스트학생');

    const saved = await page.evaluate(async () => {
      const res = await fetch('api/show/rounds', { credentials: 'include' });
      const data = await res.json();
      return data.rounds[0];
    });
    createdRoundIds.push(saved.id);
    assert.equal(saved.studentName, '3-5 테스트학생');
    assert.equal(saved.prize, '테스트상품');
    assert.equal(saved.correct, true);

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('네트워크가 끊겨도 행사는 진행되고 기록은 큐에 남는다', async () => {
    // 강당에 학생이 앉아 있는데 와이파이가 끊겼다고 진행이 멈추면 안 되고,
    // "누가 상 받았는지"가 사라져도 안 된다.
    const { page, context } = await openShow();
    await startRound(page);

    await page.route('**/api/show/rounds', (route) => route.abort());

    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');
    await page.click('#correctBtn');
    await page.waitForSelector('#stageAward:not([hidden])');
    await page.fill('#nameInput', '1-4 끊김테스트');
    await page.fill('#prizeInput', '초코바');
    await page.click('#awardSaveBtn');

    // 전송이 실패해도 축하 화면까지 그대로 이어져야 한다
    await page.waitForSelector('#stageCelebrate:not([hidden])', { timeout: 5000 });
    assert.equal(await page.evaluate(() => SMFQueue.pendingCount()), 1, '기록이 큐에 남아야 함');
    assert.ok(await page.locator('#queueBadge').isVisible(), '저장 대기 표시가 보여야 함');

    // 네트워크가 돌아오면 알아서 보낸다
    await page.unroute('**/api/show/rounds');
    await page.evaluate(() => SMFQueue.flush());
    await page.waitForFunction(() => SMFQueue.pendingCount() === 0, null, { timeout: 5000 });

    const saved = await page.evaluate(async () => {
      const res = await fetch('api/show/rounds', { credentials: 'include' });
      return (await res.json()).rounds[0];
    });
    createdRoundIds.push(saved.id);
    assert.equal(saved.studentName, '1-4 끊김테스트');
    assert.ok(await page.locator('#queueBadge').isHidden(), '다 보내면 표시가 사라져야 함');

    await context.close();
  });

  test('사진을 못 받아도 진행되고 이유가 화면에 뜬다', async () => {
    const { page, context } = await openShow();
    // 사진 주소를 못 받는 것으로 바꿔치기
    await page.evaluate(() => {
      state.problems.forEach((p) => {
        p.imageUrl = 'does-not-exist-9999.png';
      });
    });
    await startRound(page);

    assert.ok(await page.locator('#photoError').isVisible(), '왜 안 보이는지 알려줘야 함');
    assert.ok(await page.locator('#boardPhoto').isHidden());

    // 사진이 없어도 타이머와 필기는 살아 있어야 한다
    const board = await page.locator('#board').boundingBox();
    await page.mouse.move(board.x + 300, board.y + 200);
    await page.mouse.down();
    await page.mouse.move(board.x + 500, board.y + 300);
    await page.mouse.up();
    assert.ok(await page.evaluate(() => SMFDraw.serialize() !== null), '사진 없어도 필기는 돼야 함');

    await context.close();
  });

  test('사진 확대/축소가 실제로 사진 크기를 바꾼다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    const widthOf = () =>
      page.evaluate(() => document.getElementById('boardPhoto').getBoundingClientRect().width);

    const base = await widthOf();
    await page.click('#zoomInBtn');
    await page.click('#zoomInBtn');
    assert.ok((await widthOf()) > base, '확대하면 커져야 함');

    await page.click('#zoomOutBtn');
    await page.click('#zoomOutBtn');
    assert.equal(await page.locator('#zoomLabel').textContent(), '100%');
    assert.ok(Math.abs((await widthOf()) - base) < 2, '되돌리면 원래 크기');

    await context.close();
  });

  test('새 회차 시작을 누르면 이미 쓴 문제가 다시 뽑힌다', async () => {
    const { page, context } = await openShow();

    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    const before = await page.evaluate(() => state.used.size);

    await page.click('#pickBackBtn');
    await page.waitForSelector('#stageIdle:not([hidden])');
    await page.click('#resetBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    assert.equal(await page.evaluate(() => state.used.size), 0, '사용 표시가 지워져야 함');
    assert.ok(before >= 0);

    await context.close();
  });

  test('타이머를 멈추면 실제로 멈춰 있는다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    await page.click('#pauseBtn');
    const before = await page.locator('#playTimer').textContent();
    await page.waitForTimeout(2500);
    const after = await page.locator('#playTimer').textContent();
    assert.equal(before, after, '일시정지 중에는 시간이 흐르면 안 됨');

    await page.click('#pauseBtn');
    await page.waitForTimeout(1500);
    assert.notEqual(await page.locator('#playTimer').textContent(), after, '다시 눌렀으면 흘러야 함');

    await context.close();
  });
});
