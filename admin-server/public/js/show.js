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
  answer: $('stageAnswer'),
  reveal: $('stageReveal'),
  celebrate: $('stageCelebrate'),
};

const state = {
  problems: [],
  used: new Set(), // 이번 회차에 이미 쓴 문제
  roundNo: 0,
  problem: null,
  secondsLeft: 0,
  timerId: null,
  startedAt: 0,
  lastTickSecond: null,
  photoZoom: 1, // 사진 확대 배율(강당 뒤에서 안 보이면 키운다)
  lastLevel: null, // 방금 고른 난이도. 다음 라운드를 한 번에 시작하려고 기억한다
  ignoreServerUsed: false, // 한 바퀴 다 돌면 서버가 준 사용 기록을 무시
  judged: false, // 이번 사람의 답을 이미 판정했는지(두 번 눌려도 한 번만)
};

/* ---------- 화면 전환 ---------- */

// 등장 연출이 끝날 때까지 화면을 잠가둔다.
// 연출은 transform으로만 움직이기 때문에, 버튼이 눈에 보이는 위치와 실제로
// 눌리는 위치가 그 사이 다르다. 급하게 두 번 누르면 엉뚱한 버튼이 눌린다
// (브라우저 테스트에서 "시작!" 대신 옆 버튼이 눌려 화면이 안 넘어갔다).
// 시간은 연출 쪽이 알고 있으므로 거기서 가져온다. 두 숫자를 따로 두면
// 한쪽만 고쳤을 때 다시 같은 사고가 난다.
const STAGE_SETTLE_MS = SMFShowAnim.settleMs || 0;
let settleTimer = null;

function lockWhileEntering(el) {
  clearTimeout(settleTimer);
  // 어떤 경우에도 잠긴 채로 남으면 안 된다. 매번 전부 푼 뒤 이번 것만 잠근다.
  Object.values(stages).forEach((stage) => {
    stage.style.pointerEvents = '';
  });
  if (!SMFShowAnim.enabled) return;

  el.style.pointerEvents = 'none';
  settleTimer = setTimeout(() => {
    el.style.pointerEvents = '';
  }, STAGE_SETTLE_MS);
}

// 지금 떠 있는 화면. 전환 연출은 "물러나는 판"이 있어야 성립하므로,
// 화면을 전부 닫아버리지 않고 직전 것을 하나 들고 있는다.
let currentStage = null;

function show(name) {
  const el = stages[name];
  // 같은 화면을 다시 그리는 경우(목록 갱신 등)는 전환하지 않는다. 산만하다.
  const already = el === currentStage;
  const prev = already ? null : currentStage;

  // 목표와 물러나는 판만 남기고 전부 닫는다.
  // 어떤 경우에도 화면 세 개가 겹쳐 있는 상태로 가지 않는다.
  Object.values(stages).forEach((stage) => {
    if (stage !== el && stage !== prev) {
      stage.hidden = true;
      SMFShowAnim.clearStage(stage);
    }
  });
  el.hidden = false;
  currentStage = el;
  // 들어가기 전에 이 판을 비운다. 지난번 물러날 때의 기울기가 남아 있으면
  // 기울어진 채로 시작한다. 연출이 끝난 뒤에 지우는 방식은 안 통한다
  // (같은 판에 걸린 카메라 연출이 지운 값을 다시 써넣는다).
  SMFShowAnim.clearStage(el);

  if (!already) SMFShowAnim.transition3d(prev, el);
  SMFShowAnim.stageIn(el);
  lockWhileEntering(el);

  // 대기 화면에서만 로고가 글자 단위로 서고, 그 뒤로 천천히 숨쉰다.
  if (name === 'idle') {
    const logo = document.querySelector('.show-logo');
    // 줄 단위로 넘긴다. 제목 전체를 넘기면 줄바꿈이 사라진다.
    SMFShowAnim.splitIn(logo.querySelectorAll('.logo-line'), 0.05);
    SMFShowAnim.breathe(logo);
  } else {
    SMFShowAnim.stopBreathe();
  }
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
    const total = state.problems.filter((p) => p.difficulty === level).length;

    // 다 냈으면 한 바퀴 더 돈다. 그래서 "0개"가 아니라 "한 바퀴 돌았음"으로 쓴다.
    card.querySelector('.pick-count').textContent =
      total === 0 ? '없음' : left === 0 ? '한 바퀴 돌았음' : `${left}개 남음`;
    // 등록된 문제가 아예 없을 때만 막는다.
    card.disabled = total === 0;
  });
}

/**
 * 그 난이도에서 아직 안 낸 문제 중 하나를 무작위로 뽑는다.
 * 다 냈으면 그 난이도만 조용히 비우고 다시 돈다. 진행자가 "처음부터"를
 * 눌러줄 일이 없어야 한다. 점심시간에 문제가 떨어졌다고 화면이 멈추면
 * 그 자리에서 할 게 없다.
 */
function pickProblem(level) {
  let pool = remaining(level);
  if (!pool.length) {
    state.problems.forEach((p) => {
      if (!level || p.difficulty === level) state.used.delete(p.id);
    });
    // 서버가 알려준 "최근에 쓴 문제"도 이 시점부터는 무시한다.
    // 안 그러면 새로고침할 때마다 방금 비운 게 되살아난다.
    state.ignoreServerUsed = true;
    pool = remaining(level);
  }
  if (!pool.length) return null; // 그 난이도에 등록된 문제가 아예 없는 경우
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
  SMFShowAnim.urgentOff();
}

function startTimer() {
  stopTimer();

  state.timerId = setInterval(() => {
    state.secondsLeft -= 1;
    renderTimer();

    // 마지막 10초는 초읽기. 같은 초에 두 번 울리지 않게 확인한다.
    if (state.secondsLeft <= 10 && state.secondsLeft > 0 && state.lastTickSecond !== state.secondsLeft) {
      state.lastTickSecond = state.secondsLeft;
      SMFShowAnim.sounds.tick();
      SMFShowAnim.timerBeat($('playTimer'), true); // 마지막 10초는 더 크게 뛴다
      SMFShowAnim.urgentOn(); // 화면 가장자리가 붉게 맥동 -> 뒤에서도 보인다
    }

    if (state.secondsLeft <= 0) {
      stopTimer();
      SMFShowAnim.urgentOff();
      SMFShowAnim.sounds.timesUp();
      SMFShowAnim.shakeScreen(30);
      SMFShowAnim.flash('#ff5f56', 0.4);
      SMFShowAnim.shake($('playTimer'));
      // 진행 바의 작은 글자만으로는 강당 뒤에서 끝난 걸 모른다.
      // 한가운데에 크게 띄웠다가 지운다(학생이 쓴 걸 계속 덮으면 안 되므로).
      SMFShowAnim.titleCard('시간 종료!', '#ff5f56');
      // 아무도 못 맞혔으니 정답을 보여준다. 진행자가 누를 버튼은 이제 없다.
      // 안내가 지나간 뒤에 넘어간다.
      setTimeout(() => showAnswerPlate('시간 종료'), 1500);
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
  side: { maxW: 0.62, maxH: 0.88 },
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
  // 어느 배치든 사진은 왼쪽 위에 붙인다.
  // 세로 가운데로 놓으면 남는 공간이 위아래로 쪼개져서 어디에도 제대로 못 쓴다.
  // 위로 붙이면 오른쪽 여백과 아래 여백이 하나로 이어져 ㄴ자 필기 공간이 된다.
  photo.style.top = `${pad}px`;
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
  state.lastLevel = level;
  startWithProblem(problem);
}

// 행사는 속도가 생명이라, 매 라운드 난이도를 다시 고르게 하지 않는다.
// 방금 낸 난이도로 바로 다음 문제를 낸다. 다 냈으면 뽑기 쪽에서 알아서
// 한 바퀴 더 돌리므로 여기서 남은 개수를 따질 필요가 없다.
function goNextRound() {
  if (state.lastLevel !== null) {
    goReady(state.lastLevel);
    return;
  }
  goPick();
}

function startWithProblem(problem) {
  state.problem = problem;
  state.roundNo += 1;

  $('readyRound').textContent = `제 ${state.roundNo} 문제`;
  $('readyBadgeFace').textContent = problem.difficulty;
  // 단원을 미리 알려주면 학생들이 무슨 내용인지 감을 잡고 손을 든다
  $('readyUnit').textContent = problem.unit || '';
  $('readyUnit').hidden = !problem.unit;
  const limit = TIME_LIMITS[problem.difficulty] ?? DEFAULT_LIMIT;
  $('readyTime').textContent = `제한시간 ${formatTime(limit)}`;
  show('ready');
  SMFShowAnim.titleIn($('readyRound'));
  SMFShowAnim.badgeSlam($('readyBadge'));

  // 이 화면이 떠 있는 동안 사진을 미리 받아둔다(시작하자마자 보이도록)
  preloadImage(problem.imageUrl).catch(() => {});
}

/** 칠판으로 돌아간다. 화면이 다시 보이게 된 다음에야 크기를 잴 수 있다. */
function backToBoard() {
  show('play');
  requestAnimationFrame(() => {
    SMFDraw.resize();
    layoutPhoto();
  });
}

async function goPlay() {
  const problem = state.problem;
  const limit = TIME_LIMITS[problem.difficulty] ?? DEFAULT_LIMIT;

  $('playRound').textContent = `제 ${state.roundNo} 문제`;
  $('playBadge').textContent = problem.difficulty;
  state.secondsLeft = limit;
  state.lastTickSecond = null;
  state.judged = false;
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
  SMFShowAnim.photoIn($('boardPhoto'));
  SMFShowAnim.timerIn($('playTimer'));
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

/* ---------- 답 입력과 채점 ----------
 * 진행자가 맞았다/틀렸다를 손으로 누르지 않는다. 답을 넣으면 앱이 판정한다. */

function goAnswer() {
  const objective = state.problem.questionType === 'objective';
  $('choiceRow').hidden = !objective;
  $('typedBox').hidden = objective;
  $('typedField').value = '';
  show('answer');
}

/** 숫자판으로 한 글자 넣거나 지운다. 값은 여기서만 바뀐다. */
function typeKey(key) {
  const field = $('typedField');
  if (key === 'back') field.value = field.value.slice(0, -1);
  else if (field.value.length < 24) field.value += key;
}

/**
 * 사람이 넣은 것과 등록된 정답을 견준다.
 * 앞뒤 공백이나 사이 공백 차이로 맞은 답이 틀렸다고 나오면 그 자리에서 항의가 나온다.
 */
function sameAnswer(typed, correct) {
  const tidy = (v) =>
    String(v ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  return tidy(typed) === tidy(correct);
}

function submitAnswer(value) {
  const typed = String(value ?? '').trim();
  if (!typed) return;
  if (state.judged) return; // 두 번 눌려도 한 번만 판정한다
  state.judged = true;
  stopTimer();
  judge(sameAnswer(typed, state.problem.answer), typed);
}

/**
 * 맞으면 축하 화면, 틀리면 같은 문제로 다음 사람.
 * 남기는 기록은 없다. 상품은 진행자가 그 자리에서 손으로 준다.
 */
function judge(correct, typed) {
  if (correct) {
    state.used.add(state.problem.id); // 맞힌 문제만 "낸 문제"로 친다
    SMFShowAnim.sounds.fanfare();
    show('celebrate');
    SMFShowAnim.celebrate();
    SMFShowAnim.trophyIn(null, document.querySelector('.celebrate-name'));
    return;
  }

  SMFShowAnim.sounds.wrong();
  SMFShowAnim.reject();
  nextPerson(typed);
}

/**
 * 틀렸다. 같은 문제로 다음 사람이 나온다.
 * 새 사람이 앞사람 풀이 위에 쓰거나 남은 10초만 받으면 안 되므로,
 * 칠판을 지우고 시간을 처음부터 준다. 사진은 이미 떠 있으니 다시 받지 않는다.
 */
function nextPerson(typed) {
  SMFShowAnim.titleCard(typed ? `${typed} 아니야` : '아니야', '#ff5f56', 1400);

  setTimeout(() => {
    SMFDraw.clear();
    updateDrawButtons();
    state.judged = false;
    state.secondsLeft = TIME_LIMITS[state.problem.difficulty] ?? DEFAULT_LIMIT;
    state.lastTickSecond = null;
    renderTimer();

    show('play');
    requestAnimationFrame(() => {
      SMFDraw.resize();
      layoutPhoto();
    });
    startTimer();
  }, 1500);
}

/**
 * 정답판. 아무도 못 맞히고 시간이 끝났을 때 쓴다.
 * 바로 까면 김이 샌다. 뜸을 들인 뒤 정답이 돌아 들어온다.
 */
async function showAnswerPlate(label) {
  stopTimer();
  state.used.add(state.problem.id);
  fitAnswerText($('revealAnswer'), String(state.problem.answer ?? ''));
  SMFShowAnim.unsplit($('revealLabel'));
  $('revealLabel').textContent = label;

  $('revealAnswer').hidden = true;
  $('revealJudge').hidden = true;
  show('reveal');

  await SMFShowAnim.suspense($('revealLabel'));

  $('revealAnswer').hidden = false;
  SMFShowAnim.sounds.reveal();
  SMFShowAnim.slam($('revealAnswer'));

  // 다음으로 가는 버튼은 정답이 자리잡은 뒤에 올라온다
  setTimeout(() => {
    $('revealJudge').hidden = false;
    SMFShowAnim.listIn($('revealJudge').querySelectorAll('.btn'), 80);
  }, 700);
}

function goIdle() {
  show('idle');
}

/* ---------- 그리기 도구 상태 ---------- */

// 지울 게 없는데 눌리는 버튼은 눌러보고 아무 일도 안 일어나서 헷갈린다.
function updateDrawButtons() {
  const empty = SMFDraw.isEmpty();
  $('undoBtn').disabled = empty;
  $('clearBtn').disabled = empty;
}

/* ---------- 세션 ---------- */

// 점심시간 내내 켜두면 세션이 만료돼 문제 목록을 못 읽는다.
// 주기적으로 확인해서, 끊겼으면 화면에 띄우고 다시 로그인하게 한다.
const SESSION_CHECK_MS = 4 * 60 * 1000;

async function watchSession() {
  const check = async () => {
    try {
      const me = await getJSON(API.me);
      $('sessionWarning').hidden = Boolean(me.authenticated);
    } catch (err) {
      // 네트워크 문제일 수도 있으니 경고까지는 띄우지 않는다
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
  $('pickBackBtn').addEventListener('click', goIdle);

  document.querySelectorAll('.pick-card').forEach((card) => {
    card.addEventListener('click', () => goReady(card.dataset.level));
  });

  $('goBtn').addEventListener('click', goPlay);
  $('readyBackBtn').addEventListener('click', goPick);

  // 답 입력과 채점
  $('answerBtn').addEventListener('click', goAnswer);
  $('answerBackBtn').addEventListener('click', backToBoard);
  document.querySelectorAll('#choiceRow .choice').forEach((btn) => {
    btn.addEventListener('click', () => submitAnswer(btn.dataset.choice));
  });
  document.querySelectorAll('#keypad .key').forEach((btn) => {
    btn.addEventListener('click', () => typeKey(btn.dataset.key));
  });
  $('submitBtn').addEventListener('click', () => submitAnswer($('typedField').value));
  $('revealNextBtn').addEventListener('click', goNextRound);

  $('backToBoardBtn').addEventListener('click', backToBoard);

  $('celebrateNextBtn').addEventListener('click', goNextRound);
  $('celebrateChangeBtn').addEventListener('click', goPick);

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

  // 판 크기는 창 크기 말고도 바뀐다(전체화면 전환, 진행 바 안의 글자 변화 등).
  // 그때 캔버스를 다시 맞추지 않으면 학생이 쓴 글씨가 보이는 위치와 어긋난다.
  // 획은 좌표로 들고 있어서 다시 그리면 그대로 살아난다.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      SMFDraw.resize();
      layoutPhoto();
    }).observe($('board'));
  }

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

  SMFShowAnim.pressable(document.querySelectorAll('.btn, .pick-face'));
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

  // 배경에 거품을 띄운다. 완전히 멈춘 화면은 고장 난 것처럼 보인다.
  SMFShowAnim.ambient($('ambient'));

  SMFDraw.init({
    board: $('board'),
    canvas: $('boardCanvas'),
    onChange: updateDrawButtons,
  });
  watchSession();

  await loadProblems().catch(() => {});
  setPhotoZoom(1);
  show('idle');
}

boot();
