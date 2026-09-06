/* 강당 라이브 이벤트 진행 화면.
 *
 * 전자칠판 한 대로 전부 돌아간다. 화면 하나가 상태를 갈아끼우는 방식이라
 * 페이지 이동이 없고(=사진 다시 받느라 끊기지 않음), 진행 중 새로고침도 안 일어난다.
 *
 * 흐름: 대기 → 난이도 → 예고 → 풀이 → 정답공개 → 판정 → (정답이면) 상품 등록 → 축하 → 대기
 */

// 이 페이지는 /admin/ 아래에서 열리므로 API는 상대 경로로 부른다.
// (단독 실행이든 통합 서버의 /admin 마운트든 똑같이 동작한다)
const API = {
  me: 'api/me',
  problems: 'api/show/problems',
  rounds: 'api/show/rounds',
  prizes: 'api/show/prizes',
};

// 난이도별 제한시간
const TIME_LIMITS = { 하: 90, 중: 180, 상: 300 };
const DEFAULT_LIMIT = 180;

const $ = (id) => document.getElementById(id);

const stages = {
  auth: $('authGate'),
  idle: $('stageIdle'),
  pick: $('stagePick'),
  ready: $('stageReady'),
  play: $('stagePlay'),
  reveal: $('stageReveal'),
  award: $('stageAward'),
  celebrate: $('stageCelebrate'),
  hall: $('stageHall'),
  choose: $('stageChoose'),
};

const state = {
  problems: [],
  used: new Set(), // 이번 회차에 이미 쓴 문제
  roundNo: 0,
  problem: null,
  secondsLeft: 0,
  timerId: null,
  paused: false,
  startedAt: 0,
  lastTickSecond: null,
  photoZoom: 1, // 사진 확대 배율(강당 뒤에서 안 보이면 키운다)
  lastPrize: '', // 상품은 대개 같은 걸 계속 주므로 다음 입력에 미리 채운다
  ignoreServerUsed: false, // "새 회차 시작"을 누르면 서버가 준 사용 기록을 무시
};

/* ---------- 화면 전환 ---------- */

function show(name) {
  Object.values(stages).forEach((el) => {
    el.hidden = true;
  });
  const el = stages[name];
  el.hidden = false;
  SMFShowAnim.stageIn(el);
}

/* ---------- 서버 통신 ---------- */

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`${url} 실패`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} 실패`);
  return res.json();
}

/* ---------- 문제 고르기 ---------- */

async function loadProblems() {
  const data = await getJSON(API.problems);
  state.problems = data.problems;
  // 서버가 "최근에 쓴 문제"를 알려준다. 진행 중 새로고침해도 같은 문제가 다시 안 나온다.
  if (!state.ignoreServerUsed) {
    state.problems.forEach((p) => {
      if (p.used) state.used.add(p.id);
    });
  }
  updatePickCounts();
}

function remaining(level) {
  return state.problems.filter((p) => (!level || p.difficulty === level) && !state.used.has(p.id));
}

function updatePickCounts() {
  document.querySelectorAll('.pick-card').forEach((card) => {
    const level = card.dataset.level;
    const left = remaining(level).length;
    card.querySelector('.pick-count').textContent = `남은 문제 ${left}개`;
    card.disabled = left === 0;
  });
}

function pickProblem(level) {
  const pool = remaining(level);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ---------- 사진 미리 받기 ---------- */

// 문제를 띄운 뒤에 사진을 받기 시작하면 몇 초간 빈 화면이 보인다.
// 예고 화면("제 N문제")이 떠 있는 동안 미리 받아두면 시작하자마자 바로 보인다.
const preloaded = new Map(); // url -> Promise<HTMLImageElement>

function preloadImage(url) {
  if (!url) return Promise.reject(new Error('사진 주소가 없음'));
  if (!preloaded.has(url)) {
    preloaded.set(
      url,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => {
          preloaded.delete(url); // 실패한 건 캐시에 남기지 않는다(다시 시도 가능하게)
          reject(new Error('사진을 불러오지 못함'));
        };
        image.src = url;
      })
    );
  }
  return preloaded.get(url);
}

/* ---------- 문제 직접 고르기 ---------- */

// 난이도 랜덤이 기본이지만, "오늘은 이거 낼래" 하는 경우가 있다.
// 이미 쓴 문제도 목록에는 보여주되 눌리지 않게 해서, 왜 안 나오는지 알 수 있게 한다.
function goChoose() {
  const list = $('chooseList');
  list.textContent = '';

  const sorted = [...state.problems].sort((a, b) => {
    const order = { 하: 0, 중: 1, 상: 2 };
    return (order[a.difficulty] ?? 9) - (order[b.difficulty] ?? 9);
  });

  $('chooseEmpty').hidden = sorted.length > 0;

  sorted.forEach((problem) => {
    const used = state.used.has(problem.id);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'choose-row';
    row.disabled = used;

    const badge = document.createElement('span');
    badge.className = 'choose-badge';
    badge.textContent = problem.difficulty;

    const body = document.createElement('span');
    body.className = 'choose-body';

    // 관리자가 입력한 값이라 textContent로만 넣는다(태그로 해석 금지)
    const title = document.createElement('span');
    title.className = 'choose-title';
    title.textContent = problem.title;

    const meta = document.createElement('span');
    meta.className = 'choose-meta';
    meta.textContent = used ? '이번 회차에 이미 냈음' : problem.unit || '단원 미지정';

    body.append(title, meta);
    row.append(badge, body);
    row.addEventListener('click', () => startWithProblem(problem));
    list.appendChild(row);
  });

  show('choose');
  SMFShowAnim.listIn(list.querySelectorAll('.choose-row'), 30);
}

/* ---------- 타이머 ---------- */

function formatTime(seconds) {
  const m = Math.floor(Math.max(seconds, 0) / 60);
  const s = Math.max(seconds, 0) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  const el = $('playTimer');
  const out = state.secondsLeft <= 0;
  // 0:00으로만 두면 멈춘 건지 끝난 건지 헷갈린다. 끝났으면 그렇게 쓴다.
  el.textContent = out ? '시간 종료' : formatTime(state.secondsLeft);
  el.classList.toggle('urgent', state.secondsLeft <= 10);
  el.classList.toggle('timeup', out);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
}

function startTimer() {
  stopTimer();
  state.paused = false;
  $('pauseBtn').textContent = '일시정지';

  state.timerId = setInterval(() => {
    if (state.paused) return;
    state.secondsLeft -= 1;
    renderTimer();

    // 마지막 10초는 초읽기. 같은 초에 두 번 울리지 않게 확인한다.
    if (state.secondsLeft <= 10 && state.secondsLeft > 0 && state.lastTickSecond !== state.secondsLeft) {
      state.lastTickSecond = state.secondsLeft;
      SMFShowAnim.sounds.tick();
      SMFShowAnim.timerBeat($('playTimer'));
    }

    if (state.secondsLeft <= 0) {
      stopTimer();
      SMFShowAnim.sounds.timesUp();
      SMFShowAnim.shake($('playTimer'));
      // 시간이 끝나도 화면을 강제로 넘기지 않는다. 진행자가 상황 보고 넘기게.
    }
  }, 1000);
}

/* ---------- 사진 배치 ---------- */

// 사진 배치는 사진의 비율에 따라 둘 중 하나를 고른다.
//
//  - 옆에 두기: 사진을 왼쪽에 세우고 오른쪽을 필기 공간으로 (정사각/세로로 긴 사진)
//  - 위에 두기: 사진을 위쪽에 넓게 깔고 아래를 필기 공간으로 (가로로 긴 사진)
//
// 교과서 한 문제를 캡처하면 대개 가로로 길다. 그걸 옆에 두기로 그리면
// 폭 제한에 걸려 높이를 절반도 못 쓰는데, 강당 뒤에서는 그만큼 안 보인다.
// 그래서 실제로 더 크게 나오는 쪽을 계산해서 고른다.
// 캔버스는 어느 쪽이든 판 전체를 덮으므로 남는 공간 어디에나 쓸 수 있다.
const LAYOUTS = {
  side: { maxW: 0.62, maxH: 0.94 },
  top: { maxW: 0.98, maxH: 0.62 },
};

function layoutPhoto() {
  const board = $('board');
  const photo = $('boardPhoto');
  if (!photo.naturalWidth) return;

  // 크기는 transform 영향을 안 받는 offset*로 잰다(show-draw.js의 resize와 같은 이유)
  const boardW = board.offsetWidth;
  const boardH = board.offsetHeight;
  const pad = boardH * 0.03;

  const fitFor = (limits) =>
    Math.min(
      (boardH * limits.maxH - pad * 2) / photo.naturalHeight,
      (boardW * limits.maxW - pad * 2) / photo.naturalWidth
    );

  const sideFit = fitFor(LAYOUTS.side);
  const topFit = fitFor(LAYOUTS.top);
  const useTop = topFit > sideFit;

  const scale = Math.max(useTop ? topFit : sideFit, 0) * state.photoZoom;
  const width = photo.naturalWidth * scale;
  const height = photo.naturalHeight * scale;

  photo.style.width = `${width}px`;
  photo.style.height = `${height}px`;
  photo.style.left = `${pad}px`;
  // 위에 두기는 위쪽 정렬, 옆에 두기는 세로 가운데.
  // 확대해서 판보다 커지면 어느 쪽이든 위를 맞춘다(가운데 정렬하면 문제 윗부분이 잘린다).
  photo.style.top = useTop ? `${pad}px` : `${Math.max((boardH - height) / 2, 0)}px`;
}

const ZOOM_STEP = 0.15;
const ZOOM_RANGE = { min: 0.6, max: 2.4 };

function setPhotoZoom(next) {
  state.photoZoom = clampNumber(next, ZOOM_RANGE.min, ZOOM_RANGE.max);
  $('zoomLabel').textContent = `${Math.round(state.photoZoom * 100)}%`;
  layoutPhoto();
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* ---------- 라운드 진행 ---------- */

function goPick() {
  updatePickCounts();
  show('pick');
}

function goReady(level) {
  const problem = pickProblem(level);
  if (!problem) return;
  startWithProblem(problem);
}

function startWithProblem(problem) {
  state.problem = problem;
  state.roundNo += 1;

  $('readyRound').textContent = `제 ${state.roundNo} 문제`;
  $('readyBadge').textContent = problem.difficulty;
  // 단원을 미리 알려주면 학생들이 무슨 내용인지 감을 잡고 손을 든다
  $('readyUnit').textContent = problem.unit || '';
  $('readyUnit').hidden = !problem.unit;
  const limit = TIME_LIMITS[problem.difficulty] ?? DEFAULT_LIMIT;
  $('readyTime').textContent = `제한시간 ${formatTime(limit)}`;
  show('ready');

  // 이 화면이 떠 있는 동안 사진을 미리 받아둔다(시작하자마자 보이도록)
  preloadImage(problem.imageUrl).catch(() => {});
}

async function goPlay() {
  const problem = state.problem;
  const limit = TIME_LIMITS[problem.difficulty] ?? DEFAULT_LIMIT;

  $('playRound').textContent = `제 ${state.roundNo} 문제`;
  $('playBadge').textContent = problem.difficulty;
  state.secondsLeft = limit;
  state.lastTickSecond = null;
  renderTimer();

  const photo = $('boardPhoto');
  photo.src = problem.imageUrl;
  photo.hidden = false;
  $('photoError').hidden = true;
  // 사진을 못 받으면 빈 판만 남아서 진행자가 무슨 상황인지 알 수 없다.
  // 최소한 "왜 안 보이는지"는 화면에 띄운다(그 사이에도 필기는 계속 된다).
  preloadImage(problem.imageUrl).catch(() => {
    photo.hidden = true;
    $('photoError').hidden = false;
  });

  setPhotoZoom(1);
  show('play');
  SMFDraw.clear();
  updateDrawButtons();
  // 화면이 보이게 된 다음에야 크기를 잴 수 있다
  requestAnimationFrame(() => {
    SMFDraw.resize();
    layoutPhoto();
  });

  await SMFShowAnim.countdown(3);
  state.startedAt = Date.now();
  startTimer();
}

// 정답이 "7"일 수도 있고 "a_n = 2·3^(n-1) (단, n은 자연수)"일 수도 있다.
// 크기를 하나로 고정하면 짧은 답은 초라하고 긴 답은 화면을 넘겨서 버튼을 가린다.
// 길이에 따라 단계적으로 줄인다.
const ANSWER_SIZES = [
  { upTo: 3, vmin: 22 },
  { upTo: 6, vmin: 15 },
  { upTo: 12, vmin: 9 },
  { upTo: 24, vmin: 6 },
  { upTo: Infinity, vmin: 4.2 },
];

function fitAnswerText(el, answer) {
  el.textContent = answer;
  const size = ANSWER_SIZES.find((s) => answer.length <= s.upTo);
  el.style.fontSize = `${size.vmin}vmin`;
}

function goReveal() {
  stopTimer();
  fitAnswerText($('revealAnswer'), String(state.problem.answer ?? ''));
  show('reveal');
  SMFShowAnim.sounds.reveal();
  SMFShowAnim.slam($('revealAnswer'));
}

function goAward(correct) {
  state.correct = correct;
  state.durationMs = state.startedAt ? Date.now() - state.startedAt : null;

  if (correct) {
    SMFShowAnim.sounds.correct();
    $('awardTitle').textContent = '누가 맞혔어?';
    $('prizeInput').parentElement.hidden = false;
  } else {
    SMFShowAnim.sounds.wrong();
    // 틀렸어도 누가 도전했는지는 남겨둔다(참가 기록)
    $('awardTitle').textContent = '누가 도전했어?';
    $('prizeInput').parentElement.hidden = true;
  }

  $('nameInput').value = '';
  // 상품은 보통 같은 걸 계속 주므로 직전 값을 미리 채워둔다(고치고 싶으면 지우면 됨)
  $('prizeInput').value = correct ? state.lastPrize || '' : '';
  show('award');
  setTimeout(() => $('nameInput').focus(), 300);
}

async function saveRound() {
  const name = $('nameInput').value.trim();
  if (!name) {
    SMFShowAnim.shake($('nameInput'));
    $('nameInput').focus();
    return;
  }

  const prize = state.correct ? $('prizeInput').value.trim() : '';
  const problem = state.problem;

  // 전송이 실패해도 큐에 남아 계속 재시도된다(정답자 기록은 절대 잃으면 안 된다).
  await SMFQueue.save({
    problemId: problem.id,
    problemTitle: problem.title,
    difficulty: problem.difficulty,
    studentName: name,
    correct: state.correct,
    prize,
    durationMs: state.durationMs,
    work: SMFDraw.serialize(),
  });

  if (state.correct) state.lastPrize = prize;
  state.used.add(problem.id);
  loadPrizes();

  if (state.correct) {
    $('celebrateName').textContent = name;
    $('celebratePrize').textContent = prize;
    show('celebrate');
    SMFShowAnim.confetti();
  } else {
    goIdle();
  }
}

function skipRound() {
  if (state.problem) state.used.add(state.problem.id);
  goIdle();
}

async function goIdle() {
  show('idle');
  loadToday();
}

/* ---------- 오늘 기록 / 명예의 전당 ---------- */

async function loadToday() {
  try {
    const { rounds } = await getJSON(API.rounds);
    state.rounds = rounds;
    $('todayRounds').textContent = rounds.length;
    $('todayWins').textContent = rounds.filter((r) => r.correct).length;
    $('todayPrizes').textContent = rounds.filter((r) => r.correct && r.prize).length;
  } catch (err) {
    /* 대기 화면 숫자는 없어도 진행에 지장 없다 */
  }
}

async function loadPrizes() {
  try {
    const { prizes } = await getJSON(API.prizes);
    const list = $('prizeList');
    list.textContent = '';
    prizes.forEach((prize) => {
      const option = document.createElement('option');
      option.value = prize;
      list.appendChild(option);
    });
  } catch (err) {
    /* 자동완성은 없어도 그만 */
  }
}

async function goHall() {
  await loadToday();
  const winners = (state.rounds || []).filter((r) => r.correct);
  const list = $('hallList');
  list.textContent = '';

  $('hallEmpty').hidden = winners.length > 0;

  winners.forEach((round, index) => {
    const row = document.createElement('div');
    row.className = 'hall-row';

    const rank = document.createElement('span');
    rank.className = 'hall-rank';
    rank.textContent = `${index + 1}`;

    // 학생 이름은 진행자가 친 값이라 textContent로만 넣는다(태그로 해석되지 않게)
    const name = document.createElement('span');
    name.className = 'hall-name';
    name.textContent = round.studentName;

    const problem = document.createElement('span');
    problem.className = 'hall-problem';
    problem.textContent = round.problemTitle || '';

    const prize = document.createElement('span');
    prize.className = 'hall-prize';
    prize.textContent = round.prize || '';

    row.append(rank, name, problem, prize);
    list.appendChild(row);
  });

  show('hall');
  SMFShowAnim.listIn(list.querySelectorAll('.hall-row'));
}

// 지울 게 없는데 눌리는 버튼은 눌러보고 아무 일도 안 일어나서 헷갈린다.
function updateDrawButtons() {
  const empty = SMFDraw.isEmpty();
  $('undoBtn').disabled = empty;
  $('clearBtn').disabled = empty;
}

/* ---------- 저장 상태 / 세션 ---------- */

// 아직 서버로 못 보낸 기록이 있으면 진행자에게 조용히 알려준다.
// 행사를 끊지는 않되, 끝나기 전에 알아챌 수 있어야 한다.
function renderQueueStatus({ pending }) {
  const el = $('queueBadge');
  el.hidden = pending === 0;
  el.textContent = `저장 대기 ${pending}건`;
}

// 점심시간 내내 켜두면 세션이 만료돼 기록이 401로 튕긴다.
// 주기적으로 확인해서, 끊겼으면 화면에 띄우고 다시 로그인하게 한다.
const SESSION_CHECK_MS = 4 * 60 * 1000;

async function watchSession() {
  const check = async () => {
    try {
      const me = await getJSON(API.me);
      $('sessionWarning').hidden = Boolean(me.authenticated);
    } catch (err) {
      // 네트워크 문제일 수도 있으니 경고까지는 띄우지 않는다(큐가 알아서 재시도한다)
    }
  };
  setInterval(check, SESSION_CHECK_MS);
}

/* ---------- 전체화면 ---------- */

// 전자칠판에서 브라우저 주소창이 보이면 공간도 아깝고 학생이 잘못 누른다.
function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

/* ---------- 버튼 연결 ---------- */

function wireUp() {
  $('startBtn').addEventListener('click', goPick);
  $('fullscreenBtn').addEventListener('click', toggleFullscreen);
  $('muteBtn').addEventListener('click', () => {
    const muted = SMFShowAnim.toggleMute();
    $('muteBtn').textContent = muted ? '🔇' : '🔊';
    $('muteBtn').classList.toggle('off', muted);
  });
  $('resetBtn').addEventListener('click', () => {
    // 하루에 두 번 진행하거나, 문제를 다 쓴 뒤 다시 돌리고 싶을 때.
    // 기록은 그대로 두고 "이번 회차에 쓴 문제" 표시만 지운다.
    state.used.clear();
    state.ignoreServerUsed = true;
    state.roundNo = 0;
    updatePickCounts();
    goPick();
  });
  $('hallBtn').addEventListener('click', goHall);
  $('hallBackBtn').addEventListener('click', goIdle);
  $('pickBackBtn').addEventListener('click', goIdle);

  document.querySelectorAll('.pick-card').forEach((card) => {
    card.addEventListener('click', () => goReady(card.dataset.level));
  });

  $('chooseBtn').addEventListener('click', goChoose);
  $('chooseBackBtn').addEventListener('click', goPick);
  $('goBtn').addEventListener('click', goPlay);
  $('readyBackBtn').addEventListener('click', goPick);

  $('pauseBtn').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pauseBtn').textContent = state.paused ? '계속하기' : '일시정지';
  });
  $('addTimeBtn').addEventListener('click', () => {
    state.secondsLeft += 30;
    renderTimer();
  });

  $('revealBtn').addEventListener('click', goReveal);
  $('correctBtn').addEventListener('click', () => goAward(true));
  $('wrongBtn').addEventListener('click', () => goAward(false));
  $('backToBoardBtn').addEventListener('click', () => {
    show('play');
    requestAnimationFrame(() => {
      SMFDraw.resize();
      layoutPhoto();
    });
  });

  $('awardSaveBtn').addEventListener('click', saveRound);
  $('awardSkipBtn').addEventListener('click', skipRound);
  $('celebrateNextBtn').addEventListener('click', goPick);
  $('nameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('prizeInput').focus();
  });
  $('prizeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveRound();
  });

  // 필기 도구
  document.querySelectorAll('#colorGroup .swatch').forEach((swatch) => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('#colorGroup .swatch').forEach((s) => s.classList.remove('active'));
      swatch.classList.add('active');
      SMFDraw.setColor(swatch.dataset.color);
      $('eraserBtn').classList.remove('active');
    });
  });
  $('eraserBtn').addEventListener('click', () => {
    const on = !SMFDraw.isEraser();
    SMFDraw.setEraser(on);
    $('eraserBtn').classList.toggle('active', on);
  });
  $('zoomInBtn').addEventListener('click', () => setPhotoZoom(state.photoZoom + ZOOM_STEP));
  $('zoomOutBtn').addEventListener('click', () => setPhotoZoom(state.photoZoom - ZOOM_STEP));
  $('undoBtn').addEventListener('click', () => SMFDraw.undo());
  $('clearBtn').addEventListener('click', () => SMFDraw.clear());

  $('boardPhoto').addEventListener('load', layoutPhoto);
  window.addEventListener('resize', layoutPhoto);

  // 전자칠판에 키보드를 붙여 쓰는 경우를 위한 단축키.
  // 이름/상품을 입력하는 중에는 글자가 단축키로 먹히면 안 되므로 제외한다.
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      SMFDraw.undo();
    }
  });

  // 첫 터치에 소리를 깨운다(브라우저 자동재생 정책)
  document.addEventListener('pointerdown', SMFShowAnim.unlockAudio, { once: true });

  SMFShowAnim.pressable(document.querySelectorAll('.btn, .pick-card'));
}

/* ---------- 시작 ---------- */

async function boot() {
  wireUp();

  let me;
  try {
    me = await getJSON(API.me);
  } catch (err) {
    me = { authenticated: false };
  }
  if (!me.authenticated) {
    show('auth');
    return;
  }

  SMFDraw.init({
    board: $('board'),
    canvas: $('boardCanvas'),
    onChange: updateDrawButtons,
  });
  SMFQueue.init({ onStatus: renderQueueStatus });
  watchSession();

  await Promise.all([loadProblems().catch(() => {}), loadPrizes(), loadToday()]);
  setPhotoZoom(1);
  show('idle');
}

boot();
