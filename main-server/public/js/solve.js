const params = new URLSearchParams(window.location.search);
const problemId = params.get('id');

const img = document.getElementById('problemImage');
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const problemCard = document.getElementById('problemCardSolve');
const problemCardHeader = document.getElementById('problemCardHeader');
const canvasFrame = document.getElementById('canvasFrame');
const canvasFrameInner = document.getElementById('canvasFrameInner');

const selectBtn = document.getElementById('selectBtn');
const penBtn = document.getElementById('penBtn');
const eraserBtn = document.getElementById('eraserBtn');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const penPopup = document.getElementById('penPopup');
const penPreviewDot = document.getElementById('penPreviewDot');
const penColorRow = document.getElementById('penColorRow');
const sizeRange = document.getElementById('sizeRange');
const backBtn = document.getElementById('backBtn');
const descriptionToggleWrap = document.getElementById('descriptionToggleWrap');
const descriptionToggle = document.getElementById('descriptionToggle');
const descriptionBox = document.getElementById('descriptionBox');
const descriptionBoxInner = document.getElementById('descriptionBoxInner');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const canvasStage = document.querySelector('.canvas-stage');
const zoomLevelLabel = document.getElementById('zoomLevel');
const timerHud = document.getElementById('timerHud');
const topInfoHud = document.getElementById('topInfoHud');
const topToolsHud = document.getElementById('topToolsHud');
const timerHudIcon = document.getElementById('timerHudIcon');
const timerHudText = document.getElementById('timerHudText');
const nextProblemBtn = document.getElementById('nextProblemBtn');
const listBtn = document.getElementById('listBtn');
const answerPanel = document.getElementById('answerPanel');
const answerChoices = document.getElementById('answerChoices');
const answerForm = document.getElementById('answerForm');
const answerInput = document.getElementById('answerInput');
const submitAnswerBtn = document.getElementById('submitAnswerBtn');
const answerResult = document.getElementById('answerResult');
const answerResultText = document.getElementById('answerResultText');
const answerResultNextBtn = document.getElementById('answerResultNextBtn');
const answerResultHud = document.getElementById('answerResultHud');
const answerResultPill = document.getElementById('answerResultPill');
const answerResultRing = document.getElementById('answerResultRing');
const answerResultHudText = document.getElementById('answerResultHudText');

let tool = 'pen'; // 'pen' | 'eraser' | 'select'
let drawing = false;
let strokes = []; // {points:[{x,y}](사진 기준 비율, 여백은 0~1 밖), color, widthFrac, composite}
let currentStroke = null;
let currentProblem = null;
let problemStartedAt = null; // 문제를 열어 푼 시간을 재서 기록에 남김
let answered = false;
let selectedChoice = null;
let penColor = '#191b1f';
const ERASER_SIZE = 22;

// ---- 난이도별 제한시간 타이머 ----
// 문제가 시작되면 화면 가운데에 크게 떴다가(알림음 + 흔들림) 왼쪽 위로 날아가서 자리잡고,
// 시간이 다 되면 같은 알림음과 함께 그때까지 정답을 맞혔는지에 따라 성공/탈락을 보여준다.

const TIME_LIMITS = { 상: 300, 중: 180, 하: 90 }; // 초 단위: 5분 / 3분 / 1분 30초
let timerInterval = null;
let timeRemaining = 0;
let timerPulse = null; // 좌상단에 자리잡은 뒤 계속 도는 은은한 박동(Motion 애니메이션 핸들)
let timerLanded = false; // 인트로가 끝나 구석에 자리잡았는지(화면 크기 바뀔 때 위치 재조정용)
let hasAnsweredCorrectly = false;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Web Audio API로 짧은 알림음을 직접 만들어 재생(오디오 파일 불필요).
// 브라우저 자동재생 정책 때문에 재생이 막힐 수도 있는데, 그 경우 조용히 무시한다.
// 브라우저는 사용자가 화면을 한 번이라도 건드리기 전에는 소리를 못 내게 막는다
// (자동재생 정책). 문제를 열자마자 울리는 시작 팡파레는 바로 이 시점에 걸려서
// 그동안 한 번도 안 들렸음. 그래서
//   1) AudioContext를 소리마다 새로 만들지 않고 하나만 공유하고,
//   2) 못 낸 소리는 잠깐 기억해뒀다가 첫 터치/키 입력 때 바로 들려준다.
let sharedAudioCtx = null;
let pendingSound = null;
const PENDING_SOUND_MAX_AGE = 6000; // 너무 늦게(예: 30초 뒤) 뒤늦은 팡파레가 울리면 이상하니 제한

function getAudioCtx() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
  return sharedAudioCtx;
}

function emitTones(ctx, notes, waveType) {
  let cursor = ctx.currentTime;
  notes.forEach(({ freq, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveType || 'sine';
    osc.frequency.value = freq;
    const start = cursor;
    const end = start + dur;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
    cursor = end;
  });
}

function flushPendingSound(ctx) {
  if (!pendingSound) return;
  const sound = pendingSound;
  pendingSound = null;
  if (Date.now() - sound.queuedAt > PENDING_SOUND_MAX_AGE) return;
  emitTones(ctx, sound.notes, sound.waveType);
}

function playTones(notes, waveType) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      pendingSound = { notes, waveType, queuedAt: Date.now() };
      ctx.resume().then(() => flushPendingSound(ctx)).catch(() => {});
      return;
    }
    emitTones(ctx, notes, waveType);
  } catch (err) {
    // 오디오를 쓸 수 없는 환경이면 조용히 무시
  }
}

// 첫 사용자 조작이 들어오면 오디오 잠금을 풀고, 밀려 있던 소리를 바로 들려준다.
function unlockAudio() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => flushPendingSound(ctx)).catch(() => {});
    } else {
      flushPendingSound(ctx);
    }
  } catch (err) {
    /* 무시 */
  }
}

['pointerdown', 'keydown', 'touchstart'].forEach((type) => {
  window.addEventListener(type, unlockAudio, { passive: true });
});

// "따라라라" 느낌의 팡파르(타이머 시작/종료 때)
function playFanfare() {
  playTones(
    [523.25, 659.25, 783.99, 1046.5].map((freq) => ({ freq, dur: 0.11 })), // 도-미-솔-도
    'square'
  );
}

// "띠리링" 느낌의 짧은 알림음(정답 제출 결과)
function playAnswerSound(correct) {
  if (correct) {
    playTones(
      [
        { freq: 880, dur: 0.09 },
        { freq: 1318.5, dur: 0.16 },
      ],
      'triangle'
    );
  } else {
    playTones(
      [
        { freq: 660, dur: 0.09 },
        { freq: 415.3, dur: 0.18 },
      ],
      'triangle'
    );
  }
}

// 정답/오답, 성공/실패처럼 화면 중앙에 확 튀어나오는 큰 알림(사운드는 호출한 쪽에서 따로 재생)
let centerPopupTimeout = null;
function showCenterPopup(text, kind) {
  clearTimeout(centerPopupTimeout);
  const positive = kind === 'correct' || kind === 'success';

  answerResultHudText.textContent = text;
  answerResultHud.classList.remove('pop-correct', 'pop-incorrect');
  answerResultHud.classList.add('show', positive ? 'pop-correct' : 'pop-incorrect');

  SMFAnim.burstResult(answerResultPill, answerResultRing, { angry: !positive });

  centerPopupTimeout = setTimeout(() => {
    SMFAnim.fadeOutResult(answerResultPill, () => {
      answerResultHud.classList.remove('show', 'pop-correct', 'pop-incorrect');
    });
  }, 1500);
}

// 타이머가 가운데에서 출발해 좌상단에 착지하는 위치. 좁은 화면에서는 문제 정보 HUD와
// 겹치지 않도록 더 작고 왼쪽 위에 붙는데, 이 값들은 style.css의 미디어쿼리와 짝을 이룬다.
function timerCornerState() {
  return window.innerWidth <= 700
    ? { left: 12, top: 62, fontSize: 18, padding: '6px 12px' }
    : { left: 20, top: 76, fontSize: 22, padding: '8px 18px' };
}

function timerCenterState() {
  return {
    left: window.innerWidth / 2,
    top: window.innerHeight / 2,
    fontSize: Math.min(64, Math.round(window.innerWidth * 0.14)),
    padding: '28px 52px',
  };
}

function startTimer(difficulty) {
  clearInterval(timerInterval);
  if (timerPulse) {
    timerPulse.stop();
    timerPulse = null;
  }
  hasAnsweredCorrectly = false;
  timerLanded = false;

  timerHud.classList.remove('warning', 'expired', 'resolved', 'result-fail', 'result-success', 'result-neutral');
  timerHudIcon.textContent = '⏰';
  timeRemaining = TIME_LIMITS[difficulty] ?? 180;
  timerHudText.textContent = formatTime(timeRemaining);

  playFanfare();
  SMFAnim.timerIntro(timerHud, timerCenterState(), timerCornerState(), {
    holdMs: 700,
    onLanded: () => {
      timerLanded = true;
      timerPulse = SMFAnim.idlePulse(timerHud);
    },
  });

  timerInterval = setInterval(() => {
    timeRemaining -= 1;
    if (timeRemaining <= 0) {
      timeRemaining = 0;
      clearInterval(timerInterval);
      finishTimer();
      return;
    }
    timerHudText.textContent = formatTime(timeRemaining);
    timerHud.classList.toggle('warning', timeRemaining <= 10);
  }, 1000);
}

function finishTimer() {
  timerHud.classList.remove('warning', 'result-fail', 'result-success', 'result-neutral');
  timerHud.classList.add('expired');
  if (timerPulse) {
    timerPulse.stop();
    timerPulse = null;
  }
  SMFAnim.shake(timerHud, { distance: 6 });
  playFanfare();

  const canJudge = Boolean(currentProblem && currentProblem.hasAnswer);
  if (!canJudge) {
    timerHud.classList.add('result-neutral');
    timerHudIcon.textContent = '⏰';
    timerHudText.textContent = '시간 종료!';
    showCenterPopup('시간 종료!', 'fail');
  } else if (hasAnsweredCorrectly) {
    timerHud.classList.add('result-success');
    timerHudIcon.textContent = '🏆';
    timerHudText.textContent = '성공!';
    showCenterPopup('성공! 🏆', 'success');
  } else {
    timerHud.classList.add('result-fail');
    timerHudIcon.textContent = '💥';
    timerHudText.textContent = '탈락!';
    showCenterPopup('실패!', 'fail');
  }
}

// ---- 흰색 문제 창을 회색 배경 위에서 통째로 드래그 + 4방향 리사이즈 ----
// 사진 내부를 pan으로 옮기는 방식은 쓰지 않음. 대신 사진 자체의 표시 크기(imgWidth/imgHeight)와
// 창 크기(cardWidth/cardHeight)를 분리해서 관리한다:
//  - 가장자리 핸들로 창을 늘리면 그만큼 "필기 공간(여백)"만 늘어나고 사진은 그대로 있음
//  - 두 손가락 핀치는 사진 자체를 확대/축소하고, 창은 사진보다 작아질 수 없어서 자동으로 같이 커짐

const CARD_MIN_WIDTH = 320;
const CARD_MIN_HEIGHT = 240;
const CARD_MARGIN = 12;
const IMG_MIN_SIZE = 60;

let cardWidth = 640;
let cardHeight = 460;
let cardLeft = 0;
let cardTop = 0;
let imgWidth = 640; // 사진의 실제 표시 크기(핀치로만 바뀜)
let imgHeight = 460;
let imgOffsetLeft = 0; // 창(필기 공간) 안에서 사진 왼쪽에 있는 여백 크기
let imgOffsetTop = 0; // 창 안에서 사진 위쪽에 있는 여백 크기

function clampNum(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function headerHeight() {
  return problemCardHeader.offsetHeight || 18;
}

function answerPanelHeight() {
  return answerPanel.style.display !== 'none' ? answerPanel.offsetHeight || 0 : 0;
}

function frameContentHeight() {
  return Math.max(cardHeight - headerHeight() - answerPanelHeight(), 80);
}

function layoutCanvasFrame() {
  canvasFrame.style.height = `${frameContentHeight()}px`;
}

function applyImageSize() {
  canvasFrameInner.style.width = `${imgWidth}px`;
  canvasFrameInner.style.height = `${imgHeight}px`;
  canvasFrameInner.style.left = `${imgOffsetLeft}px`;
  canvasFrameInner.style.top = `${imgOffsetTop}px`;
}

// 사진 자동 맞춤(최초 로드/핀치/전체화면/창 크기 변경 등)일 때만 사진을 창 안에서
// 가운데로 재정렬함. 리사이즈 핸들 드래그 중에는 이 함수를 부르지 않고, 대신
// setupResizeHandle 안에서 늘어난 쪽에만 여백이 생기도록 offset을 직접 계산한다.
function centerImageInFrame() {
  imgOffsetLeft = Math.max((cardWidth - imgWidth) / 2, 0);
  imgOffsetTop = Math.max((frameContentHeight() - imgHeight) / 2, 0);
}

function applyCardBox() {
  problemCard.style.width = `${cardWidth}px`;
  problemCard.style.height = `${cardHeight}px`;
  problemCard.style.left = `${cardLeft}px`;
  problemCard.style.top = `${cardTop}px`;
  layoutCanvasFrame();
}

// 창은 사진(imgWidth/imgHeight)보다 작아질 수 없음(사진이 잘리거나 줄어들지 않도록)
function clampCardWidth() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - CARD_MARGIN * 2, CARD_MIN_WIDTH);
  const minW = Math.max(CARD_MIN_WIDTH, imgWidth || 0);
  cardWidth = Math.max(minW, Math.min(cardWidth, Math.max(maxW, minW)));
}

function clampCardHeight() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxH = Math.max(stageRect.height - CARD_MARGIN * 2, CARD_MIN_HEIGHT);
  const minH = Math.max(CARD_MIN_HEIGHT, (imgHeight || 0) + headerHeight() + answerPanelHeight());
  cardHeight = Math.max(minH, Math.min(cardHeight, Math.max(maxH, minH)));
}

// 뷰포트(스테이지) 안에 들어오도록 사진 자체 크기를 비율 유지한 채 줄임(핀치로 화면보다 크게
// 확대하거나, 창 크기 이상으로 화면이 작아졌을 때 사용)
function clampImageToStage() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxImgW = Math.max(stageRect.width - CARD_MARGIN * 2, IMG_MIN_SIZE);
  const maxImgH = Math.max(stageRect.height - CARD_MARGIN * 2 - headerHeight() - answerPanelHeight(), IMG_MIN_SIZE);
  if (imgWidth > maxImgW || imgHeight > maxImgH) {
    const shrink = Math.min(maxImgW / imgWidth, maxImgH / imgHeight);
    imgWidth = Math.max(imgWidth * shrink, IMG_MIN_SIZE);
    imgHeight = Math.max(imgHeight * shrink, IMG_MIN_SIZE);
  }
}

function clampCardPosition() {
  const stageRect = canvasStage.getBoundingClientRect();
  const cardRect = problemCard.getBoundingClientRect();
  const maxLeft = Math.max(CARD_MARGIN, stageRect.width - cardRect.width - CARD_MARGIN);
  const maxTop = Math.max(CARD_MARGIN, stageRect.height - cardRect.height - CARD_MARGIN);
  cardLeft = Math.min(Math.max(cardLeft, CARD_MARGIN), maxLeft);
  cardTop = Math.min(Math.max(cardTop, CARD_MARGIN), maxTop);
}

function centerCard() {
  clampCardWidth();
  clampCardHeight();
  applyCardBox();
  const stageRect = canvasStage.getBoundingClientRect();
  const cardRect = problemCard.getBoundingClientRect();
  cardLeft = Math.max(CARD_MARGIN, (stageRect.width - cardRect.width) / 2);
  cardTop = Math.max(CARD_MARGIN, (stageRect.height - cardRect.height) / 2);
  centerImageInFrame();
  applyImageSize();
  applyCardBox();
}

// ---- 헤더를 잡고 창 전체를 드래그 (버튼/입력 위에서는 드래그 시작 안 함) ----

let draggingCard = false;
let dragStart = null;

problemCardHeader.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button, input, .tool-icons')) return;
  draggingCard = true;
  problemCardHeader.setPointerCapture(e.pointerId);
  problemCardHeader.classList.add('dragging');
  problemCard.classList.add('dragging');
  document.body.style.userSelect = 'none';
  dragStart = { x: e.clientX, y: e.clientY, left: cardLeft, top: cardTop };
});

problemCardHeader.addEventListener('pointermove', (e) => {
  if (!draggingCard) return;
  cardLeft = dragStart.left + (e.clientX - dragStart.x);
  cardTop = dragStart.top + (e.clientY - dragStart.y);
  clampCardPosition();
  applyCardBox();
});

function stopDragCard(e) {
  if (!draggingCard) return;
  draggingCard = false;
  problemCardHeader.classList.remove('dragging');
  problemCard.classList.remove('dragging');
  document.body.style.userSelect = '';
  if (e && problemCardHeader.hasPointerCapture(e.pointerId)) {
    problemCardHeader.releasePointerCapture(e.pointerId);
  }
}

problemCardHeader.addEventListener('pointerup', stopDragCard);
problemCardHeader.addEventListener('pointercancel', stopDragCard);

// ---- 가장자리 핸들로 창 크기 조절: 잡은 방향의 축만 늘어남 ----

function setupResizeHandle(el) {
  const dir = el.dataset.dir; // 'e' | 'w' | 'n' | 's'
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    problemCard.classList.add('resizing');
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = cardWidth;
    const startH = cardHeight;
    const startLeft = cardLeft;
    const startTop = cardTop;
    const startOffsetLeft = imgOffsetLeft;
    const startOffsetTop = imgOffsetTop;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dir === 'e') {
        cardWidth = Math.max(CARD_MIN_WIDTH, startW + dx);
      } else if (dir === 'w') {
        const nextWidth = Math.max(CARD_MIN_WIDTH, startW - dx);
        cardLeft = startLeft - (nextWidth - startW);
        cardWidth = nextWidth;
      } else if (dir === 's') {
        cardHeight = Math.max(CARD_MIN_HEIGHT, startH + dy);
      } else if (dir === 'n') {
        const nextHeight = Math.max(CARD_MIN_HEIGHT, startH - dy);
        cardTop = startTop - (nextHeight - startH);
        cardHeight = nextHeight;
      }
      // 리사이즈는 "확대"가 아니라 필기 공간을 늘리는 것뿐이라 확대율(%) 표시는 건드리지 않음.
      clampCardWidth();
      clampCardHeight();

      // 사진은 화면에서 절대 움직이면 안 되므로, 늘어난 만큼을 잡아당긴 쪽의 여백에만 더해줌.
      // (예: 왼쪽 핸들을 당기면 창의 왼쪽 경계가 왼쪽으로 이동하는 동시에 사진 왼쪽 여백도
      // 같은 만큼 늘어나서, 결과적으로 사진의 화면상 절대 위치는 그대로 유지됨)
      if (dir === 'e') {
        imgOffsetLeft = clampNum(startOffsetLeft, 0, Math.max(cardWidth - imgWidth, 0));
      } else if (dir === 'w') {
        const grown = cardWidth - startW;
        imgOffsetLeft = clampNum(startOffsetLeft + grown, 0, Math.max(cardWidth - imgWidth, 0));
      } else if (dir === 's') {
        imgOffsetTop = clampNum(startOffsetTop, 0, Math.max(frameContentHeight() - imgHeight, 0));
      } else if (dir === 'n') {
        const grown = cardHeight - startH;
        imgOffsetTop = clampNum(startOffsetTop + grown, 0, Math.max(frameContentHeight() - imgHeight, 0));
      }

      applyCardBox();
      applyImageSize();
      // 캔버스가 창 전체를 덮으므로 창 크기가 바뀌면 캔버스도 같이 다시 잡아줘야
      // 이미 써놓은 필기가 늘어나거나 밀리지 않는다.
      resizeCanvas();
    }
    function onUp() {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      problemCard.classList.remove('resizing');
      clampCardPosition();
      applyCardBox();
      resizeCanvas();
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

document.querySelectorAll('.resize-handle').forEach(setupResizeHandle);

// ---- 확대/축소: 캔버스 위 두 손가락 핀치 제스처로 너비+높이를 함께(진짜 줌) 조절 ----

let baseFitWidth = null; // 100% 기준 너비(px)

function computeFitWidth() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - CARD_MARGIN * 2, CARD_MIN_WIDTH);
  const naturalW = img.naturalWidth || maxW;
  return Math.min(naturalW, maxW, 760);
}

function computeImageHeightForWidth(widthForImage) {
  const naturalW = img.naturalWidth || widthForImage;
  const naturalH = img.naturalHeight || widthForImage * 0.75;
  return (naturalH / naturalW) * widthForImage;
}

function updateZoomLabel() {
  if (!baseFitWidth) return;
  zoomLevelLabel.textContent = `${Math.round((imgWidth / baseFitWidth) * 100)}%`;
}

let zoomResizeTimer = null;

const activeTouches = new Map(); // pointerId -> {x, y}
let pinching = false;
let pinchStartDist = 0;
let pinchStartImgWidth = 0;
let pinchStartImgHeight = 0;

function touchDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// ---- 전체화면 ----

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    // 타이머·문제정보·도구 HUD는 .solve-wrap 바깥(body 직속)에 떠 있는 고정 요소라,
    // .solve-wrap만 전체화면으로 만들면 전체화면 하위 트리에 없어서 통째로 사라진다
    // (전체화면에서 펜/지우개 툴바가 아예 안 보이던 문제). 문서 전체를 전체화면으로 띄움.
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

function fitImageAndCardToStage() {
  baseFitWidth = computeFitWidth();
  imgWidth = baseFitWidth;
  imgHeight = computeImageHeightForWidth(imgWidth);
  applyImageSize();
  cardWidth = imgWidth;
  cardHeight = imgHeight + headerHeight() + answerPanelHeight();
  centerCard();
  updateZoomLabel();
  resizeCanvas();
}

document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.classList.toggle('active', Boolean(document.fullscreenElement));
  requestAnimationFrame(() => {
    if (img.naturalWidth) fitImageAndCardToStage();
  });
});

backBtn.addEventListener('click', () => {
  window.history.length > 1 ? window.history.back() : (window.location.href = 'index.html');
});

// ---- 툴 선택 (펜 / 지우개 / 선택 모드) ----

function closePenPopup() {
  penPopup.hidden = true;
}

function setPenPreview() {
  const size = Math.min(30, Math.max(4, Number(sizeRange.value)));
  penPreviewDot.style.width = `${size}px`;
  penPreviewDot.style.height = `${size}px`;
  penPreviewDot.style.background = penColor;
}

function openPenPopup() {
  penPopup.hidden = false;
  setPenPreview();
}

function setTool(newTool) {
  tool = newTool;
  selectBtn.classList.toggle('active', tool === 'select');
  penBtn.classList.toggle('active', tool === 'pen');
  eraserBtn.classList.toggle('active', tool === 'eraser');
  canvas.classList.toggle('select-mode', tool === 'select');
  if (tool !== 'pen') closePenPopup();
}

selectBtn.addEventListener('click', () => setTool('select'));

penBtn.addEventListener('click', () => {
  if (tool !== 'pen') {
    setTool('pen');
    openPenPopup();
  } else {
    penPopup.hidden ? openPenPopup() : closePenPopup();
  }
});

function clearAllStrokes() {
  if (!confirm('그린 내용을 모두 삭제 하시겠습니까?')) return;
  strokes = [];
  currentStroke = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  updateUndoState();
}

// 마지막에 그은 획 하나만 되돌리기. 획을 벡터로 들고 있어서 하나 빼고 다시 그리면 끝.
// (지우개질도 하나의 획으로 쌓이므로 잘못 지운 것도 되살아남)
function undoLastStroke() {
  if (!strokes.length) return;
  strokes.pop();
  redrawAllStrokes();
  updateUndoState();
}

function updateUndoState() {
  undoBtn.disabled = strokes.length === 0;
}

eraserBtn.addEventListener('click', () => setTool('eraser'));
eraserBtn.addEventListener('dblclick', (e) => {
  e.preventDefault();
  clearAllStrokes();
});
clearBtn.addEventListener('click', clearAllStrokes);
undoBtn.addEventListener('click', undoLastStroke);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoLastStroke();
  }
});

document.addEventListener('pointerdown', (e) => {
  if (!penPopup.hidden && !e.target.closest('.pen-tool-wrap')) closePenPopup();
});

sizeRange.addEventListener('input', setPenPreview);

penColorRow.querySelectorAll('.color-swatch').forEach((btn) => {
  btn.addEventListener('click', () => {
    penColor = btn.dataset.color;
    penColorRow.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('active', b === btn));
    setPenPreview();
  });
});

// 획(스트로크)의 점 좌표는 "사진 기준 0~1 비율"로 저장한다. 캔버스는 창 전체를
// 덮기 때문에 사진 바깥(흰 여백)에 쓴 획은 0보다 작거나 1보다 큰 값이 되고, 이건
// 정상이다. 사진을 기준으로 저장해두면 핀치로 사진을 확대/축소했을 때 필기도
// 사진에 붙어서 같이 커지고, 창만 넓혔을 때는 필기가 그대로 제자리에 있는다.
// 해상도가 바뀌어도 비트맵을 늘리지 않고 이 비율 좌표로 다시 그리기 때문에
// (redrawAllStrokes) 선이 절대 흐려지지 않는다.

let canvasDpr = 1;

function toCanvasPx(pt) {
  return {
    x: (imgOffsetLeft + pt.x * imgWidth) * canvasDpr,
    y: (imgOffsetTop + pt.y * imgHeight) * canvasDpr,
  };
}

function strokePixelWidth(stroke) {
  return stroke.widthFrac * imgWidth * canvasDpr;
}

function drawStroke(stroke) {
  if (!stroke.points.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokePixelWidth(stroke);
  ctx.strokeStyle = stroke.color;
  ctx.globalCompositeOperation = stroke.composite;
  ctx.beginPath();
  const first = toCanvasPx(stroke.points[0]);
  ctx.moveTo(first.x, first.y);
  if (stroke.points.length === 1) {
    ctx.lineTo(first.x + 0.01, first.y + 0.01);
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      const p = toCanvasPx(stroke.points[i]);
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();
}

function redrawAllStrokes() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach(drawStroke);
  ctx.globalCompositeOperation = 'source-over';
}

// 캔버스는 사진이 아니라 창(canvas-frame) 전체 크기로 잡는다. 사진 옆 여백도
// 전부 필기 가능한 영역이기 때문.
function resizeCanvas() {
  const rect = canvasFrame.getBoundingClientRect();
  canvasDpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(Math.round(rect.width * canvasDpr), 1);
  canvas.height = Math.max(Math.round(rect.height * canvasDpr), 1);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  redrawAllStrokes();
}

// 좌표는 사진 박스 기준 비율. 사진 바깥이면 0~1을 벗어난 값이 나오는데 그대로 씀.
function getPoint(e) {
  const rect = img.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / (rect.width || 1),
    y: (e.clientY - rect.top) / (rect.height || 1),
  };
}

function currentLineWidthFraction() {
  const px = tool === 'eraser' ? ERASER_SIZE : Number(sizeRange.value);
  return px / (imgWidth || 1);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') {
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activeTouches.size === 2) {
      if (drawing) {
        drawing = false;
        currentStroke = null;
      }
      pinching = true;
      const pts = [...activeTouches.values()];
      pinchStartDist = touchDistance(pts[0], pts[1]) || 1;
      pinchStartImgWidth = imgWidth;
      pinchStartImgHeight = imgHeight;
      return;
    }
    if (activeTouches.size > 2) return;
  }
  if (pinching || tool === 'select') return;

  drawing = true;
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch (err) {
    // 두 번째 손가락이 거의 동시에 닿는 등 포인터가 이미 무효화된 경우 무시
  }
  currentStroke = {
    points: [getPoint(e)],
    color: penColor,
    widthFrac: currentLineWidthFraction(),
    composite: tool === 'eraser' ? 'destination-out' : 'source-over',
  };
  drawStroke(currentStroke);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && activeTouches.has(e.pointerId)) {
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }

  if (pinching && activeTouches.size === 2) {
    const pts = [...activeTouches.values()];
    const dist = touchDistance(pts[0], pts[1]) || 1;
    const scale = dist / pinchStartDist;
    // 핀치는 사진 자체 크기만 바꾸는 진짜 확대/축소. 창은 사진보다 작아질 수 없어서 따라 커짐.
    imgWidth = Math.max(pinchStartImgWidth * scale, IMG_MIN_SIZE);
    imgHeight = Math.max(pinchStartImgHeight * scale, IMG_MIN_SIZE);
    clampImageToStage();
    cardWidth = imgWidth;
    cardHeight = imgHeight + headerHeight() + answerPanelHeight();
    clampCardWidth();
    clampCardHeight();
    centerImageInFrame();
    applyImageSize();
    applyCardBox();
    clampCardPosition();
    applyCardBox();
    updateZoomLabel();
    // 필기는 사진 기준 좌표로 저장돼 있어서, 사진이 커지면 같이 커지도록 다시 그림
    resizeCanvas();
    return;
  }

  if (!drawing || !currentStroke) return;
  const point = getPoint(e);
  const prevPoint = currentStroke.points[currentStroke.points.length - 1];
  currentStroke.points.push(point);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokePixelWidth(currentStroke);
  ctx.strokeStyle = currentStroke.color;
  ctx.globalCompositeOperation = currentStroke.composite;
  const a = toCanvasPx(prevPoint);
  const b = toCanvasPx(point);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
});

function stopDrawing(e) {
  if (!drawing) return;
  drawing = false;
  if (currentStroke && currentStroke.points.length) {
    strokes.push(currentStroke);
    updateUndoState();
  }
  currentStroke = null;
  if (e && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

function endTouch(e) {
  if (e.pointerType !== 'touch') return;
  activeTouches.delete(e.pointerId);
  if (pinching && activeTouches.size < 2) {
    pinching = false;
    clearTimeout(zoomResizeTimer);
    zoomResizeTimer = setTimeout(resizeCanvas, 100);
  }
}

canvas.addEventListener('pointerup', (e) => {
  endTouch(e);
  stopDrawing(e);
});
canvas.addEventListener('pointercancel', (e) => {
  endTouch(e);
  stopDrawing(e);
});
canvas.addEventListener('pointerleave', stopDrawing);

window.addEventListener('resize', () => {
  // 기기를 돌리거나 창 크기가 바뀌어 좁은 화면 배치로 넘어가면, 이미 자리잡은
  // 타이머의 좌표(인라인 스타일)도 새 배치에 맞춰 다시 잡아준다.
  if (timerLanded) {
    const corner = timerCornerState();
    timerHud.style.left = `${corner.left}px`;
    timerHud.style.top = `${corner.top}px`;
    timerHud.style.fontSize = `${corner.fontSize}px`;
    timerHud.style.padding = corner.padding;
  }

  if (img.naturalWidth) {
    baseFitWidth = computeFitWidth();
  }
  clampImageToStage();
  clampCardWidth();
  clampCardHeight();
  centerImageInFrame();
  applyImageSize();
  applyCardBox();
  clampCardPosition();
  applyCardBox();
  updateZoomLabel();
  resizeCanvas();
});

// ---- 정답 채점 ----

// 필기를 서버에 보낼 때는 그대로 보내지 않고 줄인다. 사진 위 한 문제 풀이라도
// 점이 수만 개가 나오는데, 대부분은 눈에 안 보일 만큼 촘촘하게 붙어 있다.
// - 좌표는 소수점 4자리(사진 폭 800px 기준 0.08px)까지만: 눈으로 차이를 못 느낌
// - 직전에 남긴 점과 너무 가까운 점은 버림(획의 시작/끝점은 항상 남김)
const WORK_COORD_DECIMALS = 4;
const WORK_MIN_POINT_GAP = 0.0025; // 사진 폭 대비 비율

function roundCoord(value) {
  return Number(value.toFixed(WORK_COORD_DECIMALS));
}

function serializeStroke(stroke) {
  const flat = [];
  let lastX = null;
  let lastY = null;

  stroke.points.forEach((point, index) => {
    const isEdge = index === 0 || index === stroke.points.length - 1;
    if (!isEdge && lastX !== null) {
      const dx = point.x - lastX;
      const dy = point.y - lastY;
      if (Math.hypot(dx, dy) < WORK_MIN_POINT_GAP) return;
    }
    lastX = point.x;
    lastY = point.y;
    flat.push(roundCoord(point.x), roundCoord(point.y));
  });

  // 점이 하나뿐인 획(톡 찍은 점)도 선분으로 만들어야 서버 형식(짝수 개)에 맞는다
  if (flat.length === 2) flat.push(flat[0], flat[1]);

  return {
    c: stroke.color,
    w: Number(stroke.widthFrac.toFixed(6)),
    e: stroke.composite === 'destination-out' ? 1 : 0,
    p: flat,
  };
}

function serializeWork() {
  const serialized = strokes.map(serializeStroke).filter((stroke) => stroke.p.length >= 2);
  if (!serialized.length) return null;
  return { v: 1, strokes: serialized };
}

// 채점이 끝난 뒤 따로 올린다. 실패해도 점수에는 영향이 없으므로 조용히 넘어간다.
async function uploadWork(attemptId) {
  if (!attemptId) return;
  const work = serializeWork();
  if (!work) return;
  try {
    await fetch(`/api/attempts/${attemptId}/work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentKey: SMFStudent.getKey(), work }),
    });
  } catch (err) {
    /* 필기 저장 실패는 학생에게 알리지 않는다 */
  }
}

async function checkAnswer(value) {
  try {
    const res = await fetch(`/api/problems/${problemId}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer: value,
        // 내 기록/오답 노트/선생님 통계를 위해 누가 얼마나 걸려 풀었는지 함께 보냄
        studentKey: SMFStudent.getKey(),
        studentName: SMFStudent.getName() || undefined,
        durationMs: problemStartedAt ? Date.now() - problemStartedAt : undefined,
      }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    return null;
  }
}

function showAnswerResult(correct, correctAnswer) {
  if (correct) hasAnsweredCorrectly = true;
  // 이미 한 번 채점됐으므로(제출은 문제당 한 번만 가능) 타이머가 나중에 다 돼도
  // 또 결과 팝업을 띄우면 안 됨 -> 타이머를 멈추고 구석 배지도 조용히 치움
  clearInterval(timerInterval);
  if (timerPulse) {
    timerPulse.stop();
    timerPulse = null;
  }
  timerHud.classList.add('resolved');
  playAnswerSound(correct);
  showCenterPopup(correct ? '정답! 🎉' : '오답! 💥', correct ? 'correct' : 'incorrect');
  answerResult.classList.remove('correct', 'incorrect');
  answerResult.classList.add(correct ? 'correct' : 'incorrect');
  if (correct) {
    answerResultText.textContent = '정답입니다! 🎉';
  } else {
    const label =
      currentProblem.questionType === 'objective' ? `${correctAnswer}번` : correctAnswer;
    answerResultText.textContent = `오답입니다. 정답: ${label}`;
  }
  answerResultNextBtn.style.display = 'inline-block';
}

// 객관식: 클릭하면 선택만 되고(하이라이트), 아직 채점 안 됨 -> "제출"을 눌러야 채점
answerChoices.querySelectorAll('.choice-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (answered) return;
    selectedChoice = btn.dataset.choice;
    answerChoices.querySelectorAll('.choice-btn').forEach((b) => {
      b.classList.toggle('selected', b === btn);
    });
  });
});

answerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (answered) return;

  const isObjective = currentProblem.questionType === 'objective';
  const value = isObjective ? selectedChoice : answerInput.value.trim();
  if (!value) return;

  answered = true;
  const result = await checkAnswer(value);
  if (!result) {
    answered = false;
    return;
  }

  // 학생이 사진 위에 쓴 풀이를 이 시도에 붙인다(오답 노트/선생님 화면에서 다시 봄).
  // 결과 표시를 막지 않도록 기다리지 않는다.
  uploadWork(result.attemptId);

  submitAnswerBtn.disabled = true;
  if (isObjective) {
    answerChoices.querySelectorAll('.choice-btn').forEach((b) => (b.disabled = true));
    const chosenBtn = answerChoices.querySelector(`[data-choice="${selectedChoice}"]`);
    chosenBtn?.classList.remove('selected');
    chosenBtn?.classList.add(result.correct ? 'correct' : 'incorrect');
    if (result.correct) {
      SMFAnim.bounce(chosenBtn); // 맞힌 선택지는 통통 튀고
    } else {
      SMFAnim.shake(chosenBtn); // 틀린 선택지는 부르르 떨고, 진짜 정답은 통통 튐
      const correctBtn = answerChoices.querySelector(`[data-choice="${result.correctAnswer}"]`);
      correctBtn?.classList.add('correct');
      SMFAnim.bounce(correctBtn);
    }
  } else {
    answerInput.disabled = true;
    if (!result.correct) SMFAnim.shake(answerInput);
  }
  showAnswerResult(result.correct, result.correctAnswer);
});

function resetAnswerPanel(problem) {
  answered = false;
  selectedChoice = null;
  answerResultText.textContent = '';
  answerResultNextBtn.style.display = 'none';
  answerResult.classList.remove('correct', 'incorrect');
  answerChoices.querySelectorAll('.choice-btn').forEach((b) => {
    b.disabled = false;
    b.classList.remove('correct', 'incorrect', 'selected');
  });
  answerInput.value = '';
  answerInput.disabled = false;
  submitAnswerBtn.disabled = false;

  if (!problem.hasAnswer) {
    answerPanel.style.display = 'none';
    return;
  }
  answerPanel.style.display = 'flex';
  const isObjective = problem.questionType === 'objective';
  answerChoices.style.display = isObjective ? 'flex' : 'none';
  answerInput.style.display = isObjective ? 'none' : 'block';
  if (isObjective) {
    SMFAnim.enterChoices(answerChoices.querySelectorAll('.choice-btn'));
  }
}

// ---- 다음 문제 (셔플백 랜덤) ----

listBtn.addEventListener('click', () => {
  if (!currentProblem) return;
  SMFAnim.navigate(`list.html?difficulty=${encodeURIComponent(currentProblem.difficulty)}`);
});

async function goToNextProblem() {
  if (!currentProblem) return;
  nextProblemBtn.disabled = true;
  answerResultNextBtn.disabled = true;
  const nextId = await getNextProblemId(currentProblem.difficulty, currentProblem.id, currentProblem.unit);
  if (nextId) {
    SMFAnim.navigate(`solve.html?id=${nextId}`);
  } else {
    nextProblemBtn.disabled = false;
    answerResultNextBtn.disabled = false;
    alert('이 난이도에는 아직 풀 수 있는 문제가 없어요.');
  }
}

nextProblemBtn.addEventListener('click', goToNextProblem);
answerResultNextBtn.addEventListener('click', goToNextProblem);

descriptionToggle.addEventListener('click', () => {
  const open = descriptionBox.classList.toggle('open');
  descriptionToggle.textContent = open ? '설명 / 해설 닫기' : '설명 / 해설 보기';
});

async function loadProblem() {
  if (!problemId) {
    document.getElementById('problemCardTitle').textContent = '잘못된 접근입니다.';
    return;
  }

  try {
    const res = await fetch(`/api/problems/${problemId}`);
    if (!res.ok) {
      document.getElementById('problemCardTitle').textContent = '문제를 찾을 수 없습니다.';
      return;
    }
    const data = await res.json();
    const problem = data.problem;
    currentProblem = problem;
    problemStartedAt = Date.now();
    resetAnswerPanel(problem);

    const badge = document.getElementById('difficultyBadge');
    badge.textContent = problem.difficulty;
    badge.classList.add(problem.difficulty);

    startTimer(problem.difficulty);

    const typeBadge = document.getElementById('typeBadge');
    typeBadge.textContent = problem.questionType === 'objective' ? '객관식' : '주관식';
    typeBadge.style.display = 'inline-block';

    document.getElementById('problemCardTitle').textContent = problem.title;

    if (problem.description) {
      descriptionToggleWrap.style.display = 'block';
      descriptionBoxInner.textContent = problem.description;
    }

    img.src = problem.imageUrl;
    img.onload = () => {
      fitImageAndCardToStage();
      requestAnimationFrame(() => {
        fitImageAndCardToStage();
        // 크기/위치가 다 잡힌 뒤에 카드가 부드럽게 올라오며 등장
        SMFAnim.cardIn(problemCard);
      });
    };
  } catch (err) {
    document.getElementById('problemCardTitle').textContent = '서버에 연결할 수 없습니다.';
  }
}

// ---- 화면 등장 연출 + 버튼 촉감 ----

SMFAnim.dropIn([topInfoHud, topToolsHud], { delay: 260, each: 90 });
updateUndoState();
SMFAnim.pressable([
  ...document.querySelectorAll('.tool-btn'),
  ...document.querySelectorAll('.top-bar .icon-btn'),
  ...document.querySelectorAll('.choice-btn'),
  nextProblemBtn,
  submitAnswerBtn,
]);
SMFAnim.hoverLift(document.querySelectorAll('.top-bar .icon-btn'), { y: -2 });

setTool('pen');
centerCard();
loadProblem();
