/* 강당 라이브 이벤트 진행 화면.
 *
 * 전자칠판 한 대로 전부 돌아간다. 화면 하나가 상태를 갈아끼우는 방식이라
 * 페이지 이동이 없고(=사진 다시 받느라 끊기지 않음), 진행 중 새로고침도 안 일어난다.
 *
 * 흐름:
 *   대기 → 난이도 → 예고 → 풀이 → [답 입력] → 채점 중 → 결과
 *                                                 ├ 정답      → 다음 문제
 *                                                 ├ 오답      → 다음 사람 (같은 문제)
 *                                                 └ 시간 종료 → 정답 공개 → 다음 문제
 *
 * 진행자가 맞았다/틀렸다를 누르지 않는다. 답을 넣으면 앱이 판정한다.
 * 기록은 아무것도 남기지 않는다. 상품은 그 자리에서 손으로 준다.
 */

// 이 페이지는 /admin/ 아래에서도 열리므로 API는 상대 경로로 부른다.
// (루트에서 열든 통합 서버의 /admin 마운트든 똑같이 동작한다)
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
  grading: $('stageGrading'),
  result: $('stageResult'),
};

// 위쪽 띠에 지금 어느 화면인지 쓴다. 진행자가 화면을 안 보고도 말할 수 있게.
const SCREEN_LABELS = {
  auth: '로그인 필요',
  idle: '대기',
  pick: '난이도 선택',
  ready: '제한시간 확인',
  play: '문제 풀이',
  grading: '채점',
  result: '결과',
};

const state = {
  problems: [],
  used: new Set(), // 이번 회차에 이미 쓴 문제
  roundNo: 0,
  problem: null,
  secondsLeft: 0,
  timerId: null,
  lastTickSecond: null,
  photoZoom: 1, // 사진 확대 배율(강당 뒤에서 안 보이면 키운다)
  lastLevel: null, // 방금 고른 난이도. 다음 라운드를 한 번에 시작하려고 기억한다
  ignoreServerUsed: false, // 한 바퀴 다 돌면 서버가 준 사용 기록을 무시
  judged: false, // 이번 사람의 답을 이미 판정했는지(두 번 눌려도 한 번만)
  resultKind: 'correct', // 'correct' | 'wrong' | 'timeup'
};

/* ---------- 화면 전환 ---------- */

// 등장 연출이 끝날 때까지 화면을 잠가둔다.
// 연출은 transform으로만 움직이기 때문에, 버튼이 눈에 보이는 위치와 실제로
// 눌리는 위치가 그 사이 다르다. 급하게 두 번 누르면 엉뚱한 버튼이 눌린다
// (브라우저 테스트에서 "시작" 대신 옆 버튼이 눌려 화면이 안 넘어갔다).
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
  // 들어가기 전에 이 판을 비운다. 지난번 물러날 때의 이동이 남아 있으면
  // 옆으로 밀린 채로 시작한다.
  SMFShowAnim.clearStage(el);

  if (!already) SMFShowAnim.transition(prev, el);
  SMFShowAnim.stageIn(el);
  lockWhileEntering(el);

  $('screenLabel').textContent = SCREEN_LABELS[name] || '';

  // 대기 화면에서만 제목이 글자 단위로 선다.
  if (name === 'idle') {
    const logo = document.querySelector('.show-logo');
    // 줄 단위로 넘긴다. 제목 전체를 넘기면 줄바꿈이 사라진다.
    SMFShowAnim.splitIn(logo.querySelectorAll('.logo-line'), 0.05);
  }
}

/* ---------- 서버 통신 ---------- */

async function getJSON(url) {
  const res = await fetch(url, { credentials: 'include' });
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
  // 같은 숫자를 난이도 카드와 대기 화면 옆칸 두 군데에 쓴다.
  document.querySelectorAll('.pick-count').forEach((slot) => {
    const level = slot.dataset.count;
    const left = remaining(level).length;
    const total = state.problems.filter((p) => p.difficulty === level).length;

    // 다 냈으면 한 바퀴 더 돈다. 그래서 "0개"가 아니라 "한 바퀴 돌았음"으로 쓴다.
    slot.textContent = total === 0 ? '없음' : left === 0 ? '한 바퀴' : `${left}개`;
  });

  // 등록된 문제가 아예 없는 난이도만 막는다.
  document.querySelectorAll('.pick-card').forEach((card) => {
    const level = card.dataset.level;
    card.disabled = state.problems.filter((p) => p.difficulty === level).length === 0;
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
// 예고 화면이 떠 있는 동안 미리 받아두면 시작하자마자 바로 보인다.
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

function currentLimit() {
  return TIME_LIMITS[state.problem?.difficulty] ?? DEFAULT_LIMIT;
}

/** 이번 사람이 문제에 쓴 시간. 화면에만 쓰고 어디에도 안 보낸다. */
function elapsedSeconds() {
  return Math.max(0, currentLimit() - Math.max(0, state.secondsLeft));
}

function renderTimer() {
  const el = $('playTimer');
  const out = state.secondsLeft <= 0;
  // 0:00으로만 두면 멈춘 건지 끝난 건지 헷갈린다. 끝났으면 그렇게 쓴다.
  el.textContent = out ? '시간 종료' : formatTime(state.secondsLeft);
  el.classList.toggle('timeup', out);
  // 게이지가 줄어드는 게 강당 뒤에서는 숫자보다 잘 보인다.
  SMFShowAnim.gauge($('playGauge'), state.secondsLeft / currentLimit(), state.secondsLeft <= 10);
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
      SMFShowAnim.timerBeat($('playTimer'), true);
      SMFShowAnim.urgentOn(); // 화면 가장자리에 빨간 테 -> 뒤에서도 보인다
    }

    if (state.secondsLeft <= 0) {
      stopTimer();
      SMFShowAnim.urgentOff();
      SMFShowAnim.sounds.timesUp();
      SMFShowAnim.shakeScreen(24);
      SMFShowAnim.shake($('playTimer'));
      // 진행 바의 작은 글자만으로는 강당 뒤에서 끝난 걸 모른다.
      // 한가운데에 크게 띄웠다가 지운다(학생이 쓴 걸 계속 덮으면 안 되므로).
      SMFShowAnim.titleCard('시간 종료', '#201e1d');
      // 아무도 못 맞혔으니 정답을 보여준다. 진행자가 누를 버튼은 이제 없다.
      // 안내가 지나간 뒤에 넘어간다.
      setTimeout(() => goGrading('timeup', ''), 1500);
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

function questionTypeLabel(problem) {
  return problem?.questionType === 'objective' ? '객관식' : '주관식';
}

function startWithProblem(problem) {
  state.problem = problem;
  state.roundNo += 1;

  $('readyRound').textContent = `제 ${state.roundNo} 문제`;
  $('readyBadgeFace').textContent = problem.difficulty;
  $('readyType').textContent = questionTypeLabel(problem);
  // 단원을 미리 알려주면 학생들이 무슨 내용인지 감을 잡고 손을 든다
  $('readyUnit').textContent = problem.unit || '—';
  $('unitName').textContent = problem.unit || '';

  SMFShowAnim.unsplit($('readyTime'));
  $('readyTime').textContent = formatTime(currentLimit());
  show('ready');
  SMFShowAnim.titleIn($('readyTime'));
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

  $('playRound').textContent = `제 ${state.roundNo} 문제`;
  $('playBadge').textContent = problem.difficulty;
  state.secondsLeft = currentLimit();
  state.lastTickSecond = null;
  state.judged = false;
  renderTimer();
  closeAnswer();

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
  startTimer();
}

/* ---------- 답 입력 ----------
 * 화면을 갈아끼우지 않고 판 위에 패널을 띄운다. 학생이 쓴 풀이가 계속 보여야
 * 진행자가 "이거 맞아?" 하고 같이 볼 수 있다.
 *
 * 판 자체는 절대 좁히지 않는다. 획 좌표를 판 너비 비율로 들고 있어서
 * 판 너비가 바뀌면 이미 쓴 글씨가 통째로 어긋난다. */

function openAnswer() {
  const objective = state.problem.questionType === 'objective';
  $('answerAsk').textContent = objective ? '객관식 · 번호를 누르세요' : '주관식 · 숫자판으로 입력';
  $('choiceRow').hidden = !objective;
  $('typedBox').hidden = objective;
  $('submitBtn').hidden = objective; // 객관식은 번호를 누르는 순간 제출이다
  $('typedField').value = '';
  $('answerPanel').hidden = false;
  SMFShowAnim.listIn($('answerPanel').querySelectorAll('.choice, .key, .btn'), 12);
}

function closeAnswer() {
  $('answerPanel').hidden = true;
}

/** 숫자판으로 한 글자 넣거나 지운다. 값은 여기서만 바뀐다. */
function typeKey(key) {
  const field = $('typedField');
  if (key === 'back') field.value = field.value.slice(0, -1);
  else if (key === 'clear') field.value = '';
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
  closeAnswer();
  goGrading(sameAnswer(typed, state.problem.answer) ? 'correct' : 'wrong', typed);
}

/* ---------- 채점과 결과 ---------- */

/**
 * 채점 중. 답을 바로 까지 않고 여기서 한 박자 쉰다.
 * 막대가 차오르는 동안 강당이 조용해진다.
 */
async function goGrading(kind, typed) {
  stopTimer();
  state.resultKind = kind;
  state.lastTyped = typed;
  state.lastElapsed = elapsedSeconds();

  $('gradingMode').textContent = questionTypeLabel(state.problem);
  $('gradingAnswer').textContent = typed || '—';
  $('gradingElapsed').textContent = formatTime(state.lastElapsed);
  $('gradingBar').style.width = '0%';
  $('gradingStep').textContent = '답안 확인';
  show('grading');

  await SMFShowAnim.gradeBar($('gradingBar'), 1400, (step) => {
    $('gradingStep').textContent = step;
  });

  goResult();
}

/**
 * 결과. 세 갈래가 한 화면이다.
 *
 *   정답      맞힌 사람이 상품을 받는다. 이 문제는 다 쓴 걸로 친다.
 *   오답      정답을 가린다. 같은 문제를 다음 사람이 푼다.
 *   시간 종료  아무도 못 맞혔으니 정답을 공개하고 다음 문제로 넘어간다.
 */
function goResult() {
  const kind = state.resultKind;
  const correct = kind === 'correct';
  const reveal = kind !== 'wrong'; // 틀렸을 때는 절대 정답을 까지 않는다

  if (kind !== 'wrong') state.used.add(state.problem.id);

  const verdict = $('verdict');
  verdict.textContent = correct ? '정답' : kind === 'timeup' ? '시간 종료' : '오답';
  verdict.classList.toggle('is-correct', correct);

  $('resultTyped').textContent = state.lastTyped || '—';
  $('resultAnswer').textContent = reveal ? String(state.problem.answer ?? '—') : '—';
  $('resultElapsed').textContent = formatTime(state.lastElapsed);

  $('resultPrize').textContent = correct ? '상품 지급' : '상품 없음';
  $('resultNote').textContent = correct
    ? '정답 — 상품을 받아가세요'
    : kind === 'timeup'
      ? '아무도 못 맞혔습니다 — 다음 문제로 갑니다'
      : '오답 — 같은 문제를 다음 사람이 풉니다';

  $('resultNextBtn').textContent = kind === 'wrong' ? '다음 사람' : '다음 문제';
  // "난이도 바꾸기"는 문제가 끝났을 때만. 같은 문제를 이어서 풀 때는 뜨면 안 된다.
  $('resultChangeBtn').hidden = kind === 'wrong';

  show('result');
  SMFShowAnim.verdictIn(verdict);

  if (correct) {
    SMFShowAnim.celebrate();
  } else if (kind === 'wrong') {
    SMFShowAnim.sounds.wrong();
    SMFShowAnim.reject();
  } else {
    SMFShowAnim.sounds.reveal();
  }
}

/** 결과 화면의 다음 버튼. 틀렸으면 같은 문제로, 아니면 새 문제로. */
function goAfterResult() {
  if (state.resultKind === 'wrong') nextPerson();
  else goNextRound();
}

/**
 * 틀렸다. 같은 문제로 다음 사람이 나온다.
 * 새 사람이 앞사람 풀이 위에 쓰거나 남은 10초만 받으면 안 되므로,
 * 칠판을 지우고 시간을 처음부터 준다. 사진은 이미 떠 있으니 다시 받지 않는다.
 */
function nextPerson() {
  SMFDraw.clear();
  updateDrawButtons();
  state.judged = false;
  state.secondsLeft = currentLimit();
  state.lastTickSecond = null;
  renderTimer();
  closeAnswer();

  show('play');
  requestAnimationFrame(() => {
    SMFDraw.resize();
    layoutPhoto();
  });
  startTimer();
}

function goIdle() {
  updatePickCounts();
  $('unitName').textContent = '';
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
    $('muteBtn').textContent = muted ? '소리 꺼짐' : '소리 켜짐';
  });
  $('pickBackBtn').addEventListener('click', goIdle);

  document.querySelectorAll('.pick-card').forEach((card) => {
    card.addEventListener('click', () => goReady(card.dataset.level));
  });

  $('goBtn').addEventListener('click', goPlay);
  $('readyBackBtn').addEventListener('click', goPick);

  // 답 입력과 채점
  $('answerBtn').addEventListener('click', openAnswer);
  $('answerBackBtn').addEventListener('click', closeAnswer);
  document.querySelectorAll('#choiceRow .choice').forEach((btn) => {
    btn.addEventListener('click', () => submitAnswer(btn.dataset.choice));
  });
  document.querySelectorAll('#keypad .key').forEach((btn) => {
    btn.addEventListener('click', () => typeKey(btn.dataset.key));
  });
  $('submitBtn').addEventListener('click', () => submitAnswer($('typedField').value));

  $('resultNextBtn').addEventListener('click', goAfterResult);
  $('resultChangeBtn').addEventListener('click', goPick);

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

  // 판 크기는 창 크기 말고도 바뀐다(전체화면 전환 등).
  // 그때 캔버스를 다시 맞추지 않으면 학생이 쓴 글씨가 보이는 위치와 어긋난다.
  // 획은 좌표로 들고 있어서 다시 그리면 그대로 살아난다.
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      SMFDraw.resize();
      layoutPhoto();
    }).observe($('board'));
  }

  // 전자칠판에 키보드를 붙여 쓰는 경우를 위한 단축키.
  // 화면에는 안내하지 않는다 — 손으로 누르는 화면이라 안내가 자리만 차지한다.
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

  SMFShowAnim.pressable(document.querySelectorAll('.btn, .chip, .choice, .key, .pick-face'));
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
  watchSession();

  await loadProblems().catch(() => {});
  setPhotoZoom(1);
  show('idle');
}

boot();
