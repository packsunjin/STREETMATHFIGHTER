const params = new URLSearchParams(window.location.search);
const problemId = params.get('id');

const img = document.getElementById('problemImage');
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const frame = document.getElementById('canvasFrame');
const viewerFrame = document.getElementById('viewerFrame');
const viewerContent = document.getElementById('viewerContent');

const penBtn = document.getElementById('penBtn');
const eraserBtn = document.getElementById('eraserBtn');
const panBtn = document.getElementById('panBtn');
const clearBtn = document.getElementById('clearBtn');
const sizeRange = document.getElementById('sizeRange');
const backBtn = document.getElementById('backBtn');
const descriptionToggleWrap = document.getElementById('descriptionToggleWrap');
const descriptionToggle = document.getElementById('descriptionToggle');
const descriptionBox = document.getElementById('descriptionBox');
const descriptionBoxInner = document.getElementById('descriptionBoxInner');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const solveWrap = document.querySelector('.solve-wrap');
const canvasStage = document.querySelector('.canvas-stage');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomLevelLabel = document.getElementById('zoomLevel');
const nextProblemBtn = document.getElementById('nextProblemBtn');
const listBtn = document.getElementById('listBtn');
const answerPanel = document.getElementById('answerPanel');
const answerChoices = document.getElementById('answerChoices');
const answerForm = document.getElementById('answerForm');
const answerInput = document.getElementById('answerInput');
const submitAnswerBtn = document.getElementById('submitAnswerBtn');
const answerResult = document.getElementById('answerResult');

let tool = 'pen'; // 'pen' | 'eraser' | 'pan'
let drawing = false;
let lastPoint = null;
let currentProblem = null;
let answered = false;
let selectedChoice = null;

// ---- 문제 창 크기(리사이즈 가능한 고정 프레임) ----
// 확대/축소는 이 프레임 안에서만 일어나고(overflow:hidden), 프레임 밖으로는 절대 안 커짐.

let viewerWidth = 640;
let viewerHeight = 420;
const VIEWER_MIN_WIDTH = 320;
const VIEWER_MIN_HEIGHT = 240;

function applyViewerSize() {
  viewerFrame.style.width = `${viewerWidth}px`;
  viewerFrame.style.height = `${viewerHeight}px`;
}

function initViewerSize() {
  const stageRect = canvasStage.getBoundingClientRect();
  viewerWidth = Math.max(Math.min(stageRect.width - 40, 760), VIEWER_MIN_WIDTH);
  viewerHeight = Math.max(Math.min(stageRect.height - 140, 560), VIEWER_MIN_HEIGHT);
  applyViewerSize();
}

function setupResizeHandle(el) {
  const dir = el.dataset.dir;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = viewerWidth;
    const startH = viewerHeight;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (dir.includes('e')) viewerWidth = Math.max(VIEWER_MIN_WIDTH, startW + dx);
      if (dir.includes('w')) viewerWidth = Math.max(VIEWER_MIN_WIDTH, startW - dx);
      if (dir.includes('s')) viewerHeight = Math.max(VIEWER_MIN_HEIGHT, startH + dy);
      if (dir.includes('n')) viewerHeight = Math.max(VIEWER_MIN_HEIGHT, startH - dy);
      applyViewerSize();
      clampPan();
      applyPan();
    }
    function onUp() {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
    }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

document.querySelectorAll('.resize-handle').forEach(setupResizeHandle);

// ---- 확대/축소 + 화면 이동(pan) ----

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.2;

let baseWidth = null; // 100% 기준(뷰어 프레임에 맞춘) 너비(px)
let zoomLevel = 1;
let panX = 0;
let panY = 0;

function computeFitWidth() {
  const availableWidth = Math.max(viewerWidth - 24, 200);
  const availableHeight = Math.max(viewerHeight - 24, 200);
  const naturalW = img.naturalWidth || availableWidth;
  const naturalH = img.naturalHeight || availableHeight;
  const scale = Math.min(availableWidth / naturalW, availableHeight / naturalH);
  return Math.max(naturalW * scale, 200);
}

function applyPan() {
  viewerContent.style.transform = `translate(${panX}px, ${panY}px)`;
}

// 프레임보다 콘텐츠가 작으면 가운데 정렬, 크면 프레임 밖으로 안 벗어나게 clamp
function clampPan() {
  const contentW = frame.offsetWidth;
  const contentH = frame.offsetHeight;

  if (contentW <= viewerWidth) {
    panX = (viewerWidth - contentW) / 2;
  } else {
    panX = Math.min(0, Math.max(viewerWidth - contentW, panX));
  }
  if (contentH <= viewerHeight) {
    panY = (viewerHeight - contentH) / 2;
  } else {
    panY = Math.min(0, Math.max(viewerHeight - contentH, panY));
  }
}

let zoomResizeTimer = null;

function applyZoom() {
  if (!baseWidth) return;
  frame.style.width = `${baseWidth * zoomLevel}px`;
  zoomLevelLabel.textContent = `${Math.round(zoomLevel * 100)}%`;
  // 캔버스 프레임의 width 트랜지션(0.2s)이 끝난 뒤에 실제 해상도를 다시 샘플링해
  // 확대/축소 중에도 부드럽게 보이면서 최종적으로는 선명하게 유지되도록 함
  clearTimeout(zoomResizeTimer);
  zoomResizeTimer = setTimeout(() => {
    resizeCanvas();
    clampPan();
    applyPan();
  }, 220);
  // 트랜지션 중에도 프레임 밖으로 안 나가도록 즉시 한 번 clamp
  requestAnimationFrame(() => {
    clampPan();
    applyPan();
  });
}

function setZoom(next) {
  zoomLevel = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  applyZoom();
}

zoomInBtn.addEventListener('click', () => setZoom(zoomLevel + ZOOM_STEP));
zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - ZOOM_STEP));

// 화면 이동(팬) 드래그 - '이동' 툴이 선택돼 있을 때만 동작
let panning = false;
let panStart = null;

canvas.addEventListener('pointerdown', (e) => {
  if (tool !== 'pan') return;
  panning = true;
  canvas.classList.add('panning');
  canvas.setPointerCapture(e.pointerId);
  panStart = { x: e.clientX, y: e.clientY, panX, panY };
});

canvas.addEventListener('pointermove', (e) => {
  if (tool !== 'pan' || !panning) return;
  panX = panStart.panX + (e.clientX - panStart.x);
  panY = panStart.panY + (e.clientY - panStart.y);
  clampPan();
  applyPan();
});

function stopPanning(e) {
  if (!panning) return;
  panning = false;
  canvas.classList.remove('panning');
  if (e && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

canvas.addEventListener('pointerup', stopPanning);
canvas.addEventListener('pointercancel', stopPanning);

// ---- 전체화면 ----

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    solveWrap.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.classList.toggle('active', Boolean(document.fullscreenElement));
  requestAnimationFrame(() => {
    initViewerSize();
    if (img.naturalWidth) {
      zoomLevel = 1;
      baseWidth = computeFitWidth();
      applyZoom();
    }
  });
});

backBtn.addEventListener('click', () => {
  window.history.length > 1 ? window.history.back() : (window.location.href = 'index.html');
});

function setTool(newTool) {
  tool = newTool;
  penBtn.classList.toggle('active', tool === 'pen');
  eraserBtn.classList.toggle('active', tool === 'eraser');
  panBtn.classList.toggle('active', tool === 'pan');
  canvas.classList.toggle('pan-mode', tool === 'pan');
  sizeRange.min = tool === 'eraser' ? 10 : 1;
  if (tool === 'eraser' && Number(sizeRange.value) < 10) {
    sizeRange.value = 20;
  }
}

penBtn.addEventListener('click', () => setTool('pen'));
eraserBtn.addEventListener('click', () => setTool('eraser'));
panBtn.addEventListener('click', () => setTool('pan'));

clearBtn.addEventListener('click', () => {
  if (confirm('그린 내용을 모두 지울까요?')) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
});

function resizeCanvas() {
  const rect = img.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const prev = document.createElement('canvas');
  prev.width = canvas.width;
  prev.height = canvas.height;
  prev.getContext('2d').drawImage(canvas, 0, 0);

  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (prev.width > 0 && prev.height > 0) {
    ctx.drawImage(prev, 0, 0, prev.width, prev.height, 0, 0, canvas.width, canvas.height);
  }
}

function getPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * canvas.width,
    y: ((e.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function strokeStyleFor() {
  const dpr = window.devicePixelRatio || 1;
  const scale = canvas.width / canvas.getBoundingClientRect().width || 1;
  return Number(sizeRange.value) * scale;
}

canvas.addEventListener('pointerdown', (e) => {
  if (tool === 'pan') return;
  drawing = true;
  canvas.setPointerCapture(e.pointerId);
  lastPoint = getPoint(e);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeStyleFor();
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = '#1d4ed8';

  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(lastPoint.x + 0.01, lastPoint.y + 0.01);
  ctx.stroke();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const point = getPoint(e);
  ctx.lineWidth = strokeStyleFor();
  ctx.beginPath();
  ctx.moveTo(lastPoint.x, lastPoint.y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  lastPoint = point;
});

function stopDrawing(e) {
  if (!drawing) return;
  drawing = false;
  lastPoint = null;
  if (e && canvas.hasPointerCapture(e.pointerId)) {
    canvas.releasePointerCapture(e.pointerId);
  }
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);

window.addEventListener('resize', () => {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - 40, VIEWER_MIN_WIDTH);
  const maxH = Math.max(stageRect.height - 140, VIEWER_MIN_HEIGHT);
  viewerWidth = Math.min(viewerWidth, maxW);
  viewerHeight = Math.min(viewerHeight, maxH);
  applyViewerSize();

  if (img.naturalWidth) {
    baseWidth = computeFitWidth();
    applyZoom();
  } else {
    resizeCanvas();
  }
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

const CHOICE_SYMBOLS = ['①', '②', '③', '④', '⑤'];

function showAnswerResult(correct, correctAnswer) {
  answerResult.classList.remove('correct', 'incorrect');
  answerResult.classList.add(correct ? 'correct' : 'incorrect');
  if (correct) {
    answerResult.textContent = '정답입니다! 🎉';
  } else {
    const label =
      currentProblem.questionType === 'objective'
        ? CHOICE_SYMBOLS[Number(correctAnswer) - 1] || correctAnswer
        : correctAnswer;
    answerResult.textContent = `오답입니다. 정답: ${label}`;
  }
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
  answerResult.textContent = '';
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

nextProblemBtn.addEventListener('click', async () => {
  if (!currentProblem) return;
  nextProblemBtn.disabled = true;
  const nextId = await getNextProblemId(currentProblem.difficulty, currentProblem.id);
  if (nextId) {
    window.location.href = `solve.html?id=${nextId}`;
  } else {
    nextProblemBtn.disabled = false;
    alert('이 난이도에는 아직 풀 수 있는 문제가 없어요.');
  }
});

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
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      baseWidth = computeFitWidth();
      applyZoom();
    };
  } catch (err) {
    document.getElementById('problemCardTitle').textContent = '서버에 연결할 수 없습니다.';
  }
}

setTool('pen');
initViewerSize();
loadProblem();
