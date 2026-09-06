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

describe('진행 화면 (브라우저)', { skip: chromium ? false : 'playwright 없음' }, () => {
  before(async () => {
    // 난이도마다 하나씩 둬서, 어떤 카드를 눌러도 문제가 나오게 한다
    for (const [difficulty, answer] of [
      ['하', '7'],
      ['중', '42'],
      ['상', '99'],
    ]) {
      const problem = await db.createProblem({
        title: `[test-e2e] ${difficulty} 문제`,
        difficulty,
        image_path: TINY_PNG,
        image_public_id: `fake-e2e-${difficulty}`,
        question_type: 'subjective',
        answer,
        unit: null,
      });
      createdProblemIds.push(problem.id);
    }

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

  /** 대기 화면에서 문제 풀이 화면까지 진행한다(카운트다운이 끝날 때까지 기다림). */
  async function startRound(page) {
    if (await page.locator('#stageIdle').isVisible()) await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    await page.locator('.pick-card:not([disabled])').first().click();
    await page.waitForSelector('#stageReady:not([hidden])');
    await page.click('#goBtn');
    await page.waitForSelector('#stagePlay:not([hidden])');
    await page.waitForTimeout(4200);
  }

  test('난이도는 상/중/하 셋뿐이다', async () => {
    const { page, context } = await openShow();
    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    const levels = await page.$$eval('.pick-card', (cards) =>
      cards.map((c) => c.querySelector('.pick-level').textContent)
    );
    assert.deepEqual(levels, ['하', '중', '상']);

    await context.close();
  });

  test('카운트다운 연출이 끝나면 화면을 덮지 않는다', async () => {
    // 카운트다운 레이어가 남으면 진행자가 아무 버튼도 못 눌러 행사가 멈춘다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    // 덮개가 남아 있으면 이 클릭이 타임아웃난다
    await page.click('#addTimeBtn', { timeout: 3000 });

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('정답을 바로 까지 않고 뜸을 들인다', async () => {
    // 누르자마자 답이 뜨면 강당이 조용해질 틈이 없다.
    // "정답은 ..." 하고 기다렸다가 나와야 한다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');

    const 뜸 = await page.evaluate(() => ({
      정답숨김: document.getElementById('revealAnswer').hidden,
      판정버튼숨김: document.getElementById('revealJudge').hidden,
      점: document.querySelectorAll('.suspense-dot').length,
    }));
    assert.equal(뜸.정답숨김, true, '정답이 바로 떠버림');
    assert.equal(뜸.판정버튼숨김, true, '판정 버튼이 정답보다 먼저 뜸');
    assert.equal(뜸.점, 3, '기다리는 표시(점 세 개)가 안 나옴');

    // 그리고 반드시 나와야 한다. 안 나오면 행사가 여기서 멈춘다.
    await page.waitForSelector('#revealAnswer:not([hidden])', { timeout: 5000 });
    await page.waitForSelector('#revealJudge:not([hidden])', { timeout: 5000 });
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.suspense-dot').length),
      0,
      '뜸 들이던 점이 안 치워짐'
    );

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('화면이 바뀔 때 와이프가 지나가고 스스로 치워진다', async () => {
    // 화면을 덮는 검은 띠라, 안 치워지면 행사가 그대로 끝난다.
    const { page, context } = await openShow();

    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    assert.ok(
      await page.evaluate(() => document.querySelectorAll('.fx-wipe').length > 0),
      '전환 연출이 아예 안 나옴'
    );

    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.fx-wipe').length), 0);

    // 덮개가 남아 있으면 이 클릭이 타임아웃난다
    await page.click('.pick-card:not([disabled])', { timeout: 3000 });
    await page.waitForSelector('#stageReady:not([hidden])');

    await context.close();
  });

  test('연출 레이어는 끝나면 모두 치워진다', async () => {
    // 안 치우면 화면 위에 쌓여서 결국 조작을 막는다.
    const { page, context } = await openShow();
    await startRound(page);

    await page.evaluate(() => {
      SMFShowAnim.flash('#16a34a');
      SMFShowAnim.ring('#16a34a');
      SMFShowAnim.confetti(30);
    });
    assert.ok(await page.evaluate(() => document.querySelectorAll('.fx').length > 0));

    await page.waitForTimeout(3200);
    const left = await page.$$eval('.fx', (els) => els.map((e) => e.className));
    assert.deepEqual(left, [], `안 치워진 레이어: ${left.join(', ')}`);

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

  test('획을 곡선으로 그려서, 다시 그려도 모양이 같다', async () => {
    // 실시간으로 이어 그리는 경로와 전체를 다시 그리는 경로가 어긋나면
    // 화면 크기가 바뀔 때 글씨 모양이 달라진다.
    const { page, context } = await openShow();
    await startRound(page);

    const board = await page.locator('#board').boundingBox();
    const cx = board.x + board.width * 0.75;
    const cy = board.y + board.height * 0.4;
    await page.mouse.move(cx + 90, cy);
    await page.mouse.down();
    for (let a = 0; a <= 360; a += 12) {
      const t = (a * Math.PI) / 180;
      await page.mouse.move(cx + 90 * Math.cos(t), cy + 90 * Math.sin(t));
    }
    await page.mouse.up();

    const inkCount = () =>
      page.evaluate(() => {
        const c = document.getElementById('boardCanvas');
        const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let ink = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 10) ink += 1;
        return ink;
      });

    const live = await inkCount();
    await page.evaluate(() => SMFDraw.resize());
    await page.waitForTimeout(200);
    const redrawn = await inkCount();

    assert.ok(live > 0, '획이 그려져야 함');
    assert.ok(
      Math.abs(live - redrawn) / live < 0.06,
      `실시간(${live})과 다시그림(${redrawn}) 모양이 다름`
    );

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

    // 지울 게 없으면 눌리지 않는다
    assert.ok(await page.locator('#undoBtn').isDisabled());
    assert.ok(await page.locator('#clearBtn').isDisabled());

    await context.close();
  });

  test('정답 공개 -> 맞혔다 -> 다음 문제로 이어진다', async () => {
    const { page, context, errors } = await openShow();
    await startRound(page);

    // 어떤 문제가 뽑힐지는 무작위라, 뽑힌 문제의 정답과 비교한다
    const expected = await page.evaluate(() => String(state.problem.answer));
    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');
    // "정답은..." 하고 뜸을 들인 뒤에야 정답이 나온다
    await page.waitForSelector('#revealAnswer:not([hidden])', { timeout: 5000 });
    assert.equal(await page.locator('#revealAnswer').textContent(), expected);
    await page.waitForSelector('#revealJudge:not([hidden])', { timeout: 5000 });

    await page.click('#correctBtn');
    await page.waitForSelector('#stageCelebrate:not([hidden])');

    // 같은 난이도에 문제가 남아 있으면 난이도 화면을 건너뛴다
    await page.evaluate(() => {
      state.used.clear();
      updatePickCounts();
    });
    await page.click('#celebrateNextBtn');
    await page.waitForSelector('#stageReady:not([hidden])', { timeout: 3000 });

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('틀렸다를 눌러도 흐름이 끊기지 않는다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');
    await page.waitForSelector('#revealJudge:not([hidden])', { timeout: 5000 });
    await page.evaluate(() => {
      state.used.clear();
      updatePickCounts();
    });
    await page.click('#wrongBtn');

    // 붉은 연출이 지나간 뒤 다음 문제 예고로
    await page.waitForSelector('#stageReady:not([hidden])', { timeout: 4000 });
    await context.close();
  });

  test('아무 기록도 서버로 보내지 않는다', async () => {
    // 풀고 상품 주면 끝이라, 남기는 게 있으면 안 된다.
    const { page, context } = await openShow();

    const writes = [];
    page.on('request', (req) => {
      if (['POST', 'PUT', 'DELETE'].includes(req.method())) {
        writes.push(`${req.method()} ${req.url()}`);
      }
    });

    await startRound(page);
    await page.click('#revealBtn');
    await page.waitForSelector('#stageReveal:not([hidden])');
    await page.waitForSelector('#revealJudge:not([hidden])', { timeout: 5000 });
    await page.click('#correctBtn');
    await page.waitForSelector('#stageCelebrate:not([hidden])');

    assert.deepEqual(writes, [], `서버에 쓴 요청이 있음: ${writes.join(', ')}`);
    await context.close();
  });

  test('정답이 길어도 화면을 넘기지 않고 판정 버튼이 가려지지 않는다', async () => {
    // 정답은 "7"일 수도 있고 "a_n = 2·3^(n-1) (단, n은 자연수)"일 수도 있다.
    const { page, context } = await openShow();

    for (const answer of ['7', 'x = 3 또는 x = -5', 'a_n = 2·3^(n-1) (단, n은 자연수)']) {
      await page.evaluate((value) => {
        state.problem = { answer: value };
        goReveal();
      }, answer);
      // 뜸 들이기가 끝나고 등장 연출(3.2배에서 줄어듦)까지 지난 뒤의 크기를 잰다
      await page.waitForSelector('#revealAnswer:not([hidden])', { timeout: 5000 });
      await page.waitForSelector('#revealJudge:not([hidden])', { timeout: 5000 });
      await page.waitForTimeout(900);

      const fit = await page.evaluate(() => {
        const el = document.getElementById('revealAnswer');
        const box = el.getBoundingClientRect();
        const judge = document.querySelector('#stageReveal .judge-actions').getBoundingClientRect();
        const back = document.getElementById('backToBoardBtn').getBoundingClientRect();
        return {
          overflow: box.width > window.innerWidth + 1 || box.height > window.innerHeight + 1,
          buttonsVisible: judge.bottom <= window.innerHeight && back.bottom <= window.innerHeight,
          labelVisible: document.querySelector('.reveal-label').getBoundingClientRect().top >= 0,
        };
      });

      assert.equal(fit.overflow, false, `"${answer}"가 화면을 넘침`);
      assert.equal(fit.buttonsVisible, true, `"${answer}"일 때 판정 버튼이 가려짐`);
      assert.equal(fit.labelVisible, true, `"${answer}"일 때 "정답은" 라벨이 잘림`);
    }

    await context.close();
  });

  test('사진 비율에 따라 배치가 바뀌고 어떤 비율도 판을 넘지 않는다', async () => {
    // 교과서 한 문제를 캡처하면 대개 가로로 길다. 그걸 옆에 두기로 그리면
    // 폭 제한에 걸려 높이를 절반도 못 써서 강당 뒤에서 안 보인다.
    const { page, context } = await openShow();

    const measure = async (w, h) => {
      const url = await page.evaluate(
        (size) => {
          const [width, height] = size;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/></svg>`;
          return `data:image/svg+xml;base64,${btoa(svg)}`;
        },
        [w, h]
      );

      await page.evaluate((src) => {
        state.problem = { ...state.problems[0], imageUrl: src, difficulty: '하' };
        state.roundNo = 1;
        return goPlay();
      }, url);
      await page.waitForTimeout(4200);

      return page.evaluate(() => {
        const board = document.getElementById('board').getBoundingClientRect();
        const photo = document.getElementById('boardPhoto').getBoundingClientRect();
        return {
          overflow:
            photo.right > board.right + 1 ||
            photo.bottom > board.bottom + 1 ||
            photo.top < board.top - 1 ||
            photo.left < board.left - 1,
          heightRatio: photo.height / board.height,
          widthRatio: photo.width / board.width,
        };
      });
    };

    const wide = await measure(1600, 500);
    assert.equal(wide.overflow, false, '가로로 긴 사진이 판을 넘음');
    assert.ok(wide.widthRatio > 0.65, `가로로 긴 사진이 너무 작음 (폭 ${wide.widthRatio})`);

    const tall = await measure(800, 1400);
    assert.equal(tall.overflow, false, '세로로 긴 사진이 판을 넘음');
    assert.ok(tall.heightRatio > 0.75, `세로로 긴 사진이 높이를 못 씀 (${tall.heightRatio})`);

    await context.close();
  });

  test('사진을 못 받아도 진행되고 이유가 화면에 뜬다', async () => {
    const { page, context } = await openShow();
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

  test('문제를 직접 골라서 낼 수 있고, 이미 낸 문제는 못 고른다', async () => {
    const { page, context } = await openShow();

    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    await page.click('#chooseBtn');
    await page.waitForSelector('#stageChoose:not([hidden])');

    assert.ok((await page.locator('.choose-row').count()) > 0, '등록된 문제가 목록에 나와야 함');

    await page.evaluate(() => {
      state.used.add(state.problems[0].id);
    });
    await page.click('#chooseBackBtn');
    await page.click('#chooseBtn');
    await page.waitForSelector('#stageChoose:not([hidden])');
    assert.ok(
      (await page.locator('.choose-row[disabled]').count()) > 0,
      '이미 낸 문제는 선택 불가여야 함'
    );

    const available = page.locator('.choose-row:not([disabled])');
    const title = await available.first().locator('.choose-title').textContent();
    await available.first().click();
    await page.waitForSelector('#stageReady:not([hidden])');
    assert.equal(await page.evaluate(() => state.problem.title), title, '고른 문제가 나와야 함');

    await context.close();
  });

  test('낸 문제 초기화를 누르면 다시 뽑힌다', async () => {
    const { page, context } = await openShow();

    await page.evaluate(() => {
      state.problems.forEach((p) => state.used.add(p.id));
      updatePickCounts();
    });
    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');
    assert.equal(await page.locator('.pick-card:not([disabled])').count(), 0, '전부 소진 상태');

    await page.click('#pickBackBtn');
    await page.waitForSelector('#stageIdle:not([hidden])');
    await page.click('#resetBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    assert.equal(await page.evaluate(() => state.used.size), 0);
    assert.ok((await page.locator('.pick-card:not([disabled])').count()) > 0);

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

  test('시간이 다 되면 알려주고, 경고 연출은 정리된다', async () => {
    const { page, context } = await openShow();
    await startRound(page);

    // 마지막 10초 -> 화면 가장자리 경고
    await page.evaluate(() => {
      state.secondsLeft = 5;
    });
    await page.waitForTimeout(1300);
    assert.ok(await page.evaluate(() => !!document.querySelector('.fx-urgent')), '경고가 떠야 함');

    // 0초 -> "시간 종료" + 경고 정리
    await page.waitForTimeout(5200);
    assert.equal(await page.locator('#playTimer').textContent(), '시간 종료');
    assert.equal(
      await page.evaluate(() => !!document.querySelector('.fx-urgent')),
      false,
      '끝났으면 경고를 치워야 함'
    );

    await context.close();
  });
});
