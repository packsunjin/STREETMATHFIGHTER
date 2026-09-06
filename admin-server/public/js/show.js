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
  state.problems.forEach((p) => {
    if (p.used) state.used.add(p.id);
  });
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

/* ---------- 타이머 ---------- */

function formatTime(seconds) {
  const m = Math.floor(Math.max(seconds, 0) / 60);
  const s = Math.max(seconds, 0) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function renderTimer() {
  const el = $('playTimer');
  el.textContent = formatTime(state.secondsLeft);
  el.classList.toggle('urgent', state.secondsLeft <= 10);
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

// 사진은 왼쪽에 크게, 오른쪽은 필기 공간으로 비워둔다.
// 캔버스는 판 전체를 덮으므로 사진 위에도, 옆 흰 공간에도 쓸 수 있다.
const PHOTO_MAX_WIDTH_RATIO = 0.62;

function layoutPhoto() {
  const board = $('board');
  const photo = $('boardPhoto');
  if (!photo.naturalWidth) return;

  // 크기는 transform 영향을 안 받는 offset*로 잰다(show-draw.js의 resize와 같은 이유)
  const boardW = board.offsetWidth;
  const boardH = board.offsetHeight;
  const pad = boardH * 0.03;
  const maxH = boardH - pad * 2;
  const maxW = boardW * PHOTO_MAX_WIDTH_RATIO;

  const scale = Math.min(maxH / photo.naturalHeight, maxW / photo.naturalWidth);
  const width = photo.naturalWidth * scale;
  const height = photo.naturalHeight * scale;

  photo.style.width = `${width}px`;
  photo.style.height = `${height}px`;
  photo.style.left = `${pad}px`;
  photo.style.top = `${(boardH - height) / 2}px`;
}

/* ---------- 라운드 진행 ---------- */

function goPick() {
  updatePickCounts();
  show('pick');
}

function goReady(level) {
  const problem = pickProblem(level);
  if (!problem) return;

  state.problem = problem;
  state.roundNo += 1;

  $('readyRound').textContent = `제 ${state.roundNo} 문제`;
  $('readyBadge').textContent = problem.difficulty;
  const limit = TIME_LIMITS[problem.difficulty] ?? DEFAULT_LIMIT;
  $('readyTime').textContent = `제한시간 ${formatTime(limit)}`;
  show('ready');
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

  show('play');
  SMFDraw.clear();
  // 화면이 보이게 된 다음에야 크기를 잴 수 있다
  requestAnimationFrame(() => {
    SMFDraw.resize();
    layoutPhoto();
  });

  await SMFShowAnim.countdown(3);
  state.startedAt = Date.now();
  startTimer();
}

function goReveal() {
  stopTimer();
  $('revealAnswer').textContent = state.problem.answer;
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
  $('prizeInput').value = '';
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

  try {
    await postJSON(API.rounds, {
      problemId: problem.id,
      problemTitle: problem.title,
      difficulty: problem.difficulty,
      studentName: name,
      correct: state.correct,
      prize,
      durationMs: state.durationMs,
      work: SMFDraw.serialize(),
    });
  } catch (err) {
    // 기록이 안 되더라도 행사 진행은 멈추면 안 된다. 조용히 넘어가고 화면은 이어간다.
    console.error('라운드 기록 실패', err);
  }

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

/* ---------- 버튼 연결 ---------- */

function wireUp() {
  $('startBtn').addEventListener('click', goPick);
  $('hallBtn').addEventListener('click', goHall);
  $('hallBackBtn').addEventListener('click', goIdle);
  $('pickBackBtn').addEventListener('click', goIdle);

  document.querySelectorAll('.pick-card').forEach((card) => {
    card.addEventListener('click', () => goReady(card.dataset.level));
  });

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
  $('undoBtn').addEventListener('click', () => SMFDraw.undo());
  $('clearBtn').addEventListener('click', () => SMFDraw.clear());

  $('boardPhoto').addEventListener('load', layoutPhoto);
  window.addEventListener('resize', layoutPhoto);

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

  SMFDraw.init({ board: $('board'), canvas: $('boardCanvas') });

  await Promise.all([loadProblems().catch(() => {}), loadPrizes(), loadToday()]);
  show('idle');
}

boot();
