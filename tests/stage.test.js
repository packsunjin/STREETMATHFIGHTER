// 진행 화면(show.html + js/stage.js)을 실제 브라우저로 돌려 본다.
//
// 문제 목록은 브라우저 안에서 가로채서 정해진 문제만 준다. DB에 다른 테스트가 남긴
// 문제가 섞여 있어도 결과가 흔들리지 않게 하려는 것이다. 사진은 리포에 있는 묶음 사진을 쓴다.
// 크로미움이 없는 환경에서는 통째로 건너뛴다(CI에서는 설치한다).
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

const PROBLEMS = [
  // 상: 주관식, 분수 정답
  { id: 9001, title: '극한', difficulty: '상', unit: '미적분', imageUrl: '/problem-set/05.jpg', questionType: 'subjective', answer: '3/4', description: '출제자: 한성률' },
  { id: 9002, title: '집합', difficulty: '상', unit: '공통수학2', imageUrl: '/problem-set/04.jpg', questionType: 'subjective', answer: '38', description: null },
  // 중: 객관식
  { id: 9101, title: '정육면체', difficulty: '중', unit: '기하', imageUrl: '/problem-set/11.jpg', questionType: 'objective', answer: '3', description: '출제자: 김태완' },
  // 하: 가로로 긴 사진
  { id: 9201, title: '등차수열', difficulty: '하', unit: '대수(수열)', imageUrl: '/problem-set/20.jpg', questionType: 'subjective', answer: '462', description: '출제자: 김지영' },
];

let server;
let baseUrl;
let browser;

before(async () => {
  if (!chromium) return;
  try {
    // 설치된 playwright와 브라우저 버전이 다르면 CHROMIUM_PATH로 실행 파일을 직접 지정한다
    browser = await chromium.launch(
      process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
    );
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
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.pool.end();
});

/** 진행 화면을 연다. 시계는 가짜라서 runFor로 원하는 만큼 흘려보낸다. */
async function openStage(t, { width = 1920, height = 1080, problems = PROBLEMS } = {}) {
  if (!browser) {
    t.skip('크로미움이 없어 브라우저 테스트를 건너뜀');
    return null;
  }
  const page = await browser.newPage({ viewport: { width, height } });
  // 합성 포인터 이벤트는 실제 포인터가 아니라서 setPointerCapture가 예외를 던진다
  await page.addInitScript(() => {
    Element.prototype.setPointerCapture = () => {};
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/api/show/problems*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ problems, noAnswer: [] }) })
  );
  await page.clock.install();
  await page.goto(baseUrl + 'show.html');
  await page.clock.runFor(500);
  const ui = {
    page,
    errors,
    active: () => page.evaluate(() => [...document.querySelectorAll('.screen.active')].map((e) => e.id).join()),
    text: (sel) => page.textContent(sel),
    key: async (k, ms = 200) => {
      await page.keyboard.press(k);
      await page.clock.runFor(ms);
    },
    /** 그 화면이 뜰 때까지 기다린다. 문제 목록 받기는 진짜 시간에, 화면 연출은 가짜 시계에 걸려 있어 둘 다 흘린다. */
    waitScreen: async (name) => {
      for (let i = 0; i < 100; i += 1) {
        if ((await ui.active()) === name) return;
        await page.clock.runFor(100);
        await new Promise((r) => setTimeout(r, 10));
      }
      assert.fail(`${name} 화면이 뜨지 않음(지금: ${await ui.active()})`);
    },
    /** 대기 화면에서 난이도를 골라 풀이 화면까지 간다 */
    startLevel: async (levelKey) => {
      await ui.key('Enter', 100);
      await ui.waitScreen('difficulty');
      await ui.key(levelKey);
      await ui.key('Enter', 3200); // 카운트다운
      await ui.waitScreen('solve');
    },
    inked: () =>
      page.evaluate(() => {
        const c = document.getElementById('canvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]) n += 1;
        return n;
      }),
    pointer: (type, pointerType, pointerId, x, y) =>
      page.evaluate(
        ([type, pointerType, pointerId, x, y]) => {
          const c = document.getElementById('canvas');
          const r = c.getBoundingClientRect();
          c.dispatchEvent(
            new PointerEvent(type, { bubbles: true, pointerId, pointerType, clientX: r.left + x, clientY: r.top + y, isPrimary: true, pressure: 0.5 })
          );
        },
        [type, pointerType, pointerId, x, y]
      ),
    /** 펜으로 (x,y)에서 오른쪽 아래로 한 획 */
    penStroke: async (x, y, pointerId = 7) => {
      await ui.pointer('pointerdown', 'pen', pointerId, x, y);
      for (let i = 1; i <= 8; i += 1) await ui.pointer('pointermove', 'pen', pointerId, x + i * 20, y + i * 6);
      await ui.pointer('pointerup', 'pen', pointerId, x + 160, y + 48);
    },
    answer: async (value) => {
      await ui.key('a', 100);
      for (const ch of value) await page.keyboard.press(ch);
      await ui.key('Enter', 1500); // 채점 막대
    },
  };
  return ui;
}

test('사진은 처음부터 판의 가로 60% · 세로 65% 안에 들어온다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1'); // 하: 가로로 긴 사진
  assert.equal(await ui.active(), 'solve');
  const box = await ui.page.evaluate(() => {
    const [w, h] = document.getElementById('questionImg').style.backgroundSize.split(' ').map(parseFloat);
    const b = document.getElementById('boardWrap');
    return { w, h, bw: b.clientWidth, bh: b.clientHeight };
  });
  assert.ok(box.w <= box.bw * 0.6 + 1, `사진 너비 ${box.w}가 판의 60%(${box.bw * 0.6})를 넘음`);
  assert.ok(box.h <= box.bh * 0.65 + 1, `사진 높이 ${box.h}가 판의 65%를 넘음`);
  assert.deepEqual(ui.errors, []);
});

test('주관식 답 칸은 숫자를 넣고 지워도 높이가 그대로다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.key('a', 100);
  const h0 = await ui.page.$eval('#answerDisplay', (e) => e.getBoundingClientRect().height);
  await ui.key('4', 50);
  const h1 = await ui.page.$eval('#answerDisplay', (e) => e.getBoundingClientRect().height);
  await ui.key('Backspace', 50);
  const h2 = await ui.page.$eval('#answerDisplay', (e) => e.getBoundingClientRect().height);
  assert.equal(h1, h0);
  assert.equal(h2, h0);
});

test('같은 수면 정답이다(3/4 = 0.75). 빈 답은 받지 않는다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  // 상에서 극한 문제가 나올 때까지(상에는 두 문제)
  for (let i = 0; i < 10; i += 1) {
    await ui.startLevel('3');
    if ((await ui.text('#unitName')) === '미적분') break;
    await ui.key('Escape'); // 풀이 중 Esc는 아무것도 안 한다 → 새로 연다
    await ui.page.reload();
    await ui.page.clock.runFor(500);
  }
  assert.equal(await ui.text('#unitName'), '미적분');
  await ui.key('a', 100);
  await ui.key('Enter', 300);
  assert.equal(await ui.active(), 'solve', '빈 답으로 제출되면 안 됨');
  for (const ch of '0.75') await ui.page.keyboard.press(ch);
  await ui.key('Enter', 1500);
  assert.equal(await ui.text('#verdict'), '정답');
  assert.equal(await ui.text('#resultCorrect'), '3/4');
});

test('펜으로 쓰는 중에 손바닥이 닿아도 획이 남고 사진이 확대되지 않는다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.pointer('pointerdown', 'pen', 7, 900, 300);
  for (let i = 1; i <= 10; i += 1) {
    await ui.pointer('pointermove', 'pen', 7, 900 + i * 20, 300 + i * 5);
    if (i === 4) await ui.pointer('pointerdown', 'touch', 9, 1000, 500);
  }
  await ui.pointer('pointermove', 'touch', 9, 1100, 600);
  await ui.pointer('pointerup', 'touch', 9, 1100, 600);
  await ui.pointer('pointerup', 'pen', 7, 1100, 350);
  assert.ok((await ui.inked()) > 0, '획이 지워짐');
  assert.equal(await ui.text('#zoomLabel'), '100%');
});

test('Ctrl+C는 칠판을 지우지 않는다. 전체 지우기는 되돌릴 수 있다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.penStroke(900, 300);
  const ink = await ui.inked();
  assert.ok(ink > 0);
  await ui.key('Control+c', 50);
  assert.equal(await ui.inked(), ink);
  await ui.key('c', 50);
  assert.equal(await ui.inked(), 0);
  await ui.key('u', 50);
  assert.equal(await ui.inked(), ink);
});

test('Esc는 한 칸만 뒤로 간다. 풀이 중에는 답 패널만 닫는다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.key('Enter', 100);
  await ui.waitScreen('difficulty');
  await ui.key('2');
  assert.equal(await ui.active(), 'confirm');
  await ui.key('Escape');
  assert.equal(await ui.active(), 'difficulty');
  await ui.key('2');
  await ui.key('Enter', 3200);
  await ui.key('a', 100);
  await ui.key('Escape');
  assert.equal(await ui.active(), 'solve');
  assert.equal(await ui.page.$eval('#answerPanel', (e) => e.style.display), 'none');
});

test('맞힌 문제는 결과 화면에서 어떻게 나가도 다시 나오지 않는다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  const answers = Object.fromEntries(PROBLEMS.filter((p) => p.difficulty === '상').map((p) => [p.unit, p.answer]));
  const seen = [];
  for (let round = 0; round < 2; round += 1) {
    await ui.startLevel('3');
    const unit = await ui.text('#unitName');
    seen.push(unit);
    await ui.answer(answers[unit]);
    assert.equal(await ui.text('#verdict'), '정답');
    await ui.key('Escape'); // 결과 화면에서 Esc로 나간다
  }
  assert.notEqual(seen[0], seen[1], `같은 문제가 두 번 나옴: ${seen}`);
});

test('틀리면 정답을 가리고, 다음 사람이 같은 문제를 빈 칠판으로 푼다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.penStroke(900, 300);
  await ui.answer('1');
  assert.equal(await ui.text('#verdict'), '오답');
  assert.equal(await ui.text('#resultCorrect'), '—');
  await ui.key('Enter', 400); // 다음 사람
  await ui.waitScreen('difficulty');
  await ui.key('1');
  await ui.key('Enter', 3200);
  assert.equal(await ui.text('#unitName'), '대수(수열)');
  assert.equal(await ui.inked(), 0);
});

test('시간이 다 되면 정답을 공개한다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.page.clock.runFor(92_000);
  assert.equal(await ui.active(), 'result');
  assert.equal(await ui.text('#verdict'), '시간 종료');
  assert.equal(await ui.text('#resultCorrect'), '462');
});

test('펜 색을 바꿔 쓸 수 있다(키 2 = 빨강). 쓰는 동안 그린 것과 다시 그린 것이 같다', async (t) => {
  const ui = await openStage(t);
  if (!ui) return;
  await ui.startLevel('1');
  await ui.key('2', 50);
  await ui.penStroke(700, 600);
  const redPixels = () =>
    ui.page.evaluate(() => {
      const c = document.getElementById('canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 1] < 90) n += 1;
      return n;
    });
  const live = await redPixels();
  assert.ok(live > 50, '빨간 획이 없음');
  // 전체 다시 그리기(되돌리기 후 다시)를 해도 거의 같은 모양이어야 한다
  await ui.key('u', 50);
  assert.equal(await ui.inked(), 0);
  await ui.key('r', 50);
  const redrawn = await redPixels();
  assert.ok(Math.abs(redrawn - live) / live < 0.25, `쓰는 중 ${live}px, 다시 그림 ${redrawn}px`);
  assert.deepEqual(ui.errors, []);
});
