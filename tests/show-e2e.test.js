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

  // 로그인은 무차별 대입을 막으려고 IP당 횟수가 제한돼 있다. 테스트마다 새로
  // 로그인하면 테스트가 늘어날수록 그 제한에 먼저 걸린다(그건 서버가 제대로
  // 막고 있다는 뜻이지 버그가 아니다). 한 번만 로그인하고 쿠키를 돌려 쓴다.
  let signedIn = null;

  async function signIn() {
    if (signedIn) return signedIn;
    const context = await browser.newContext({ viewport: BOARD });
    const page = await context.newPage();
    await page.goto(`${baseURL}/index.html`);
    await page.fill('#username', process.env.ADMIN_USERNAME);
    await page.fill('#password', process.env.ADMIN_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForTimeout(500);
    signedIn = await context.storageState();
    await context.close();
    return signedIn;
  }

  /** 로그인한 상태의 진행 화면을 연다. */
  async function openShow() {
    const storageState = await signIn();
    const context = await browser.newContext({ viewport: BOARD, storageState });
    const page = await context.newPage();

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message)));

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

  test('진행자가 목록을 뒤지는 화면은 없다', async () => {
    // 강당 앞에서 문제 목록을 넘겨보고 있을 일이 없다. 손 들면 바로 낸다.
    const { page, context } = await openShow();
    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    assert.equal(await page.locator('#stageChoose').count(), 0, '문제 목록 화면이 남아 있음');
    assert.equal(await page.locator('#chooseBtn').count(), 0, '목록으로 가는 버튼이 남아 있음');

    // 화면이 스스로를 설명하지 않는다. 하/중/상이 보이는데 "난이도를 골라"까지
    // 써 붙이면 게임 메뉴 말투가 된다.
    assert.equal(await page.locator('.stage-title').count(), 0, '설명하는 제목이 남아 있음');

    await context.close();
  });

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
    await page.click('#answerBtn', { timeout: 3000 });

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('정답을 바로 까지 않고 뜸을 들인다', async () => {
    // 누르자마자 답이 뜨면 강당이 조용해질 틈이 없다.
    // 기다렸다가 나와야 한다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    // 반환하지 않는다. evaluate가 프라미스를 기다려버리면 뜸 들이기가 끝난 뒤에
    // 돌아와서 "바로 안 뜬다"를 확인할 수가 없다.
    await page.evaluate(() => {
      showAnswerPlate('시간 종료');
    });
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

  test('화면이 3D로 교대하고, 물러난 판은 닫히고 기울기도 남지 않는다', async () => {
    // 화면끼리 돌아가며 교대한다. 물러난 판이 안 닫히면 두 화면이 겹치고,
    // 들어온 판에 기울기가 남으면 다음 연출이 기울어진 채로 시작한다.
    const { page, context } = await openShow();

    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    // 교대 중에는 물러나는 판이 아직 보이고, 기울어져 있다
    const 교대중 = await page.evaluate(() => {
      const idle = document.getElementById('stageIdle');
      return { 대기아직보임: !idle.hidden, 기울었나: idle.style.transform !== '' };
    });
    assert.equal(교대중.대기아직보임, true, '물러나는 판이 바로 사라져 교대가 안 보임');
    assert.equal(교대중.기울었나, true, '물러나는 판이 3D로 돌지 않음');

    await page.waitForTimeout(1400);

    const 정리후 = await page.evaluate(() => {
      const stages = Array.from(document.querySelectorAll('.stage'));
      // 인라인 문자열이 아니라 실제로 그려지는 값을 본다. 끝값이 기울기 0이면
      // 문자열이 남아 있어도 화면은 똑바르다. 중요한 건 "똑바로 서 있는가"다.
      const 기울었나 = (el) => {
        const m = getComputedStyle(el).transform;
        if (m === 'none') return false;
        // 함수 이름("matrix3d")에도 숫자가 들어 있어서 통째로 숫자만 뽑으면
        // 자리가 한 칸씩 밀린다. 괄호 안만 잘라서 본다.
        const args = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')')).split(',').map(Number);
        const 단위행렬 =
          args.length === 16
            ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            : [1, 0, 0, 1, 0, 0];
        return args.some((v, i) => Math.abs(v - 단위행렬[i]) > 0.5);
      };
      return {
        보이는판: stages.filter((s) => !s.hidden).map((s) => s.id),
        기울어진판: stages.filter((s) => !s.hidden && 기울었나(s)).map((s) => s.id),
      };
    });
    assert.deepEqual(정리후.보이는판, ['stagePick'], '한 화면만 남아 있어야 함');
    assert.deepEqual(정리후.기울어진판, [], '기울어진 채로 멈춘 판이 있음');

    // 덮개나 겹침이 남아 있으면 이 클릭이 타임아웃난다
    await page.click('.pick-card:not([disabled])', { timeout: 3000 });
    await page.waitForSelector('#stageReady:not([hidden])');

    await context.close();
  });

  test('시간이 끝나도 판 크기가 안 변해서 쓴 글씨가 어긋나지 않는다', async () => {
    // 타이머 글자가 "1:30"에서 "시간 종료"로 바뀌면서 진행 바 높이가 변하면,
    // 판이 그만큼 커지고 학생이 쓴 글씨가 보이는 위치와 틀어진다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    const before = await page.evaluate(() => ({
      board: document.getElementById('board').offsetHeight,
      canvas: document.getElementById('boardCanvas').offsetHeight,
    }));

    await page.evaluate(() => {
      state.secondsLeft = 1;
      renderTimer();
    });
    await page.waitForTimeout(1600);

    const after = await page.evaluate(() => ({
      board: document.getElementById('board').offsetHeight,
      canvas: document.getElementById('boardCanvas').offsetHeight,
      글자: document.getElementById('playTimer').textContent,
    }));

    assert.equal(after.글자, '시간 종료');
    assert.equal(after.board, before.board, '시간이 끝나면서 판 높이가 바뀜');
    assert.equal(after.canvas, after.board, '캔버스가 판을 못 따라감');

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('시간 종료 안내는 크게 떴다가 반드시 사라진다', async () => {
    // 학생이 쓴 걸 계속 덮고 있으면 진행자가 채점을 못 한다.
    const { page, context } = await openShow();
    await startRound(page);

    await page.evaluate(() => {
      state.secondsLeft = 1;
      renderTimer();
    });
    await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.fx-titlecard').length), 1);

    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.fx-titlecard').length), 0);

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

    // 색종이는 솟았다 떨어지느라 2.9초를 쓴다. 그보다 넉넉히 기다린 뒤 본다.
    await page.waitForTimeout(4500);
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

  test('정답을 넣으면 진행자가 아무것도 안 눌러도 축하 화면으로 간다', async () => {
    const { page, context, errors } = await openShow();
    await startRound(page);

    // 어떤 문제가 뽑힐지는 무작위라, 뽑힌 문제의 정답을 그대로 넣는다
    const expected = await page.evaluate(() => String(state.problem.answer));
    await page.click('#answerBtn');
    await page.waitForSelector('#stageAnswer:not([hidden])');

    // 진행자가 맞았다고 눌러주지 않는다. 답을 넣으면 앱이 판정한다.
    await page.evaluate((v) => submitAnswer(v), expected);
    await page.waitForSelector('#stageCelebrate:not([hidden])', { timeout: 6000 });

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

  test('틀리면 같은 문제로 다음 사람에게 넘어간다', async () => {
    // 정답을 까지 않는다. 칠판을 지우고 시간을 처음부터 줘야 다음 사람이
    // 앞사람 풀이 위에 쓰거나 남은 몇 초만 받는 일이 없다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    const before = await page.evaluate(() => {
      // 앞사람이 칠판에 뭔가 써 둔 상태를 만든다
      SMFDraw.setColor('#111111');
      return { id: state.problem.id, 제한: state.secondsLeft };
    });
    const box = await page.locator('#board').boundingBox();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => SMFDraw.isEmpty()), false, '필기가 안 됨');

    await page.evaluate(() => {
      state.secondsLeft = 12; // 시간이 얼마 안 남은 상태
      submitAnswer('__틀린답__');
    });

    // 풀이 화면은 이미 떠 있으므로 화면 전환을 기다리면 안 된다.
    // 다음 사람을 받을 준비가 됐는지(다시 판정 가능해졌는지)를 기다린다.
    await page.waitForFunction(() => state.judged === false, null, { timeout: 8000 });
    await page.waitForTimeout(200);

    const after = await page.evaluate(() => ({
      id: state.problem.id,
      칠판빔: SMFDraw.isEmpty(),
      남은시간: state.secondsLeft,
      다시판정가능: state.judged === false,
    }));
    assert.equal(after.id, before.id, '같은 문제로 이어져야 함');
    assert.equal(after.칠판빔, true, '앞사람 풀이가 남아 있음');
    assert.ok(after.남은시간 > 12, `시간이 처음부터가 아님(${after.남은시간}초)`);
    assert.equal(after.다시판정가능, true, '다음 사람이 답을 못 냄');

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('시간이 끝나면 저절로 정답이 공개된다', async () => {
    // 진행자가 누를 버튼이 이제 없다. 아무도 못 맞혔으면 화면이 알아서 넘어가야 한다.
    const { page, context, errors } = await openShow();
    await startRound(page);

    const 정답 = await page.evaluate(() => String(state.problem.answer));
    await page.evaluate(() => {
      state.secondsLeft = 1;
    });

    await page.waitForSelector('#stageReveal:not([hidden])', { timeout: 10000 });
    await page.waitForSelector('#revealAnswer:not([hidden])', { timeout: 6000 });
    assert.equal(await page.locator('#revealAnswer').textContent(), 정답);

    assert.equal(errors.length, 0, `자바스크립트 에러: ${errors.join(', ')}`);
    await context.close();
  });

  test('문제를 다 내도 막히지 않고 한 바퀴 더 돈다', async () => {
    // 점심시간에 문제가 떨어졌다고 화면이 멈추면 그 자리에서 할 게 없다.
    const { page, context } = await openShow();
    await page.click('#startBtn');
    await page.waitForSelector('#stagePick:not([hidden])');

    // 등록된 문제를 전부 "이미 냈음"으로 만든다
    await page.evaluate(() => {
      state.problems.forEach((p) => state.used.add(p.id));
      updatePickCounts();
    });

    assert.equal(
      await page.locator('.pick-card:not([disabled])').count(),
      3,
      '다 냈다고 카드가 막히면 안 된다'
    );

    await page.locator('.pick-card').first().click();
    await page.waitForSelector('#stageReady:not([hidden])', { timeout: 5000 });
    assert.ok(await page.evaluate(() => state.problem !== null), '문제가 다시 뽑혀야 함');

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
    await page.evaluate(() => submitAnswer(String(state.problem.answer)));
    await page.waitForSelector('#stageCelebrate:not([hidden])', { timeout: 6000 });

    assert.deepEqual(writes, [], `서버에 쓴 요청이 있음: ${writes.join(', ')}`);
    await context.close();
  });

  test('정답이 길어도 화면을 넘기지 않고 다음 버튼이 가려지지 않는다', async () => {
    // 정답은 "7"일 수도 있고 "a_n = 2·3^(n-1) (단, n은 자연수)"일 수도 있다.
    const { page, context } = await openShow();

    for (const answer of ['7', 'x = 3 또는 x = -5', 'a_n = 2·3^(n-1) (단, n은 자연수)']) {
      await page.evaluate((value) => {
        state.problem = { answer: value };
        showAnswerPlate('시간 종료');
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
