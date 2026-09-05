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
const solveWrap = document.querySelector('.solve-wrap');
const canvasStage = document.querySelector('.canvas-stage');
const zoomLevelLabel = document.getElementById('zoomLevel');
const timerHud = document.getElementById('timerHud');
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
const answerResultHudText = document.getElementById('answerResultHudText');

let tool = 'pen'; // 'pen' | 'eraser' | 'select'
let drawing = false;
let strokes = []; // {points:[{x,y}](0~1 비율), color, widthFrac, composite}
let currentStroke = null;
let currentProblem = null;
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
let timerFlyTimeout = null;
let timerShakeTimeout = null;
let hasAnsweredCorrectly = false;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Web Audio API로 짧은 알림음을 직접 만들어 재생(오디오 파일 불필요).
// 브라우저 자동재생 정책 때문에 재생이 막힐 수도 있는데, 그 경우 조용히 무시한다.
function playTones(notes, waveType) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const audioCtx = new AudioCtx();
    const run = () => {
      let cursor = audioCtx.currentTime;
      notes.forEach(({ freq, dur }) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = waveType || 'sine';
        osc.frequency.value = freq;
        const start = cursor;
        const end = start + dur;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(start);
        osc.stop(end + 0.02);
        cursor = end;
      });
      const totalDur = notes.reduce((sum, n) => sum + n.dur, 0);
      setTimeout(() => audioCtx.close().catch(() => {}), (totalDur + 0.3) * 1000);
    };
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(run).catch(() => {});
    } else {
      run();
    }
  } catch (err) {
    // 오디오 재생이 막힌 환경이면 조용히 무시
  }
}

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
  answerResultHud.classList.remove('show', 'pop-correct', 'pop-incorrect');
  answerResultHudText.textContent = text;
  const popClass = kind === 'correct' || kind === 'success' ? 'pop-correct' : 'pop-incorrect';
  requestAnimationFrame(() => {
    answerResultHud.classList.add('show', popClass);
  });
  centerPopupTimeout = setTimeout(() => {
    answerResultHud.classList.remove('show', 'pop-correct', 'pop-incorrect');
  }, 1400);
}

function startTimer(difficulty) {
  clearInterval(timerInterval);
  clearTimeout(timerFlyTimeout);
  clearTimeout(timerShakeTimeout);
  hasAnsweredCorrectly = false;

  timerHud.classList.remove('warning', 'expired', 'shake-start');
  timerHud.classList.add('center-start');
  timerHudIcon.textContent = '⏰';
  timeRemaining = TIME_LIMITS[difficulty] ?? 180;
  timerHudText.textContent = formatTime(timeRemaining);

  playFanfare();
  requestAnimationFrame(() => timerHud.classList.add('shake-start'));
  timerShakeTimeout = setTimeout(() => timerHud.classList.remove('shake-start'), 700);
  timerFlyTimeout = setTimeout(() => timerHud.classList.remove('center-start'), 1300);

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
  timerHud.classList.remove('warning', 'center-start', 'shake-start', 'result-fail', 'result-success', 'result-neutral');
  timerHud.classList.add('expired');
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

      // 드래그 도중에는 매번 다시 그리지 않고(느려짐/깜빡임 방지), 손을 뗄 때 한 번만 선명하게 다시 그림.
      applyCardBox();
      applyImageSize();
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
    solveWrap.requestFullscreen?.();
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
}

eraserBtn.addEventListener('click', () => setTool('eraser'));
eraserBtn.addEventListener('dblclick', (e) => {
  e.preventDefault();
  clearAllStrokes();
});
clearBtn.addEventListener('click', clearAllStrokes);

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

// 획(스트로크)의 점 좌표는 캔버스 CSS 박스 기준 0~1 비율로 저장한다.
// 확대/리사이즈로 캔버스 해상도가 바뀌어도 비트맵을 늘리지 않고 이 비율 좌표로
// 다시 그리기 때문에(redrawAllStrokes) 선이 절대 흐려지지 않는다.

function toCanvasPx(pt) {
  return { x: pt.x * canvas.width, y: pt.y * canvas.height };
}

function strokePixelWidth(stroke) {
  return stroke.widthFrac * canvas.width;
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

function resizeCanvas() {
  const rect = img.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  redrawAllStrokes();
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / (rect.width || 1),
    y: (e.clientY - rect.top) / (rect.height || 1),
  };
}

function currentLineWidthFraction() {
  const rect = canvas.getBoundingClientRect();
  const px = tool === 'eraser' ? ERASER_SIZE : Number(sizeRange.value);
  return px / (rect.width || 1);
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

async function checkAnswer(value) {
  try {
    const res = await fetch(`/api/problems/${problemId}/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: value }),
    });
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    return null;
  }
}

function showAnswerResult(correct, correctAnswer) {
  if (correct) hasAnsweredCorrectly = true;
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

  submitAnswerBtn.disabled = true;
  if (isObjective) {
    answerChoices.querySelectorAll('.choice-btn').forEach((b) => (b.disabled = true));
    const chosenBtn = answerChoices.querySelector(`[data-choice="${selectedChoice}"]`);
    chosenBtn?.classList.remove('selected');
    chosenBtn?.classList.add(result.correct ? 'correct' : 'incorrect');
    if (!result.correct) {
      const correctBtn = answerChoices.querySelector(`[data-choice="${result.correctAnswer}"]`);
      correctBtn?.classList.add('correct');
    }
  } else {
    answerInput.disabled = true;
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
}

// ---- 다음 문제 (셔플백 랜덤) ----

listBtn.addEventListener('click', () => {
  if (!currentProblem) return;
  window.location.href = `list.html?difficulty=${encodeURIComponent(currentProblem.difficulty)}`;
});

async function goToNextProblem() {
  if (!currentProblem) return;
  nextProblemBtn.disabled = true;
  answerResultNextBtn.disabled = true;
  const nextId = await getNextProblemId(currentProblem.difficulty, currentProblem.id, currentProblem.unit);
  if (nextId) {
    window.location.href = `solve.html?id=${nextId}`;
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
      });
    };
  } catch (err) {
    document.getElementById('problemCardTitle').textContent = '서버에 연결할 수 없습니다.';
  }
}

setTool('pen');
centerCard();
loadProblem();
