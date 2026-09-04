const params = new URLSearchParams(window.location.search);
const problemId = params.get('id');

const img = document.getElementById('problemImage');
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const problemCard = document.getElementById('problemCardSolve');
const problemCardHeader = document.getElementById('problemCardHeader');

const penBtn = document.getElementById('penBtn');
const eraserBtn = document.getElementById('eraserBtn');
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

let tool = 'pen'; // 'pen' | 'eraser'
let drawing = false;
let lastPoint = null;
let currentProblem = null;
let answered = false;
let selectedChoice = null;

// ---- 흰색 문제 창을 회색 배경 위에서 통째로 드래그 + 가로 리사이즈 ----
// 사진 내부를 pan으로 옮기는 방식은 쓰지 않음: 확대/축소는 창 너비를 바꾸는 것과 같고,
// 사진은 항상 width:100%로 그 너비에 맞춰 다시 흐름(reflow)됨.

const CARD_MIN_WIDTH = 320;
const CARD_MARGIN = 12;

let cardWidth = 640;
let cardLeft = 0;
let cardTop = 0;

function applyCardBox() {
  problemCard.style.width = `${cardWidth}px`;
  problemCard.style.left = `${cardLeft}px`;
  problemCard.style.top = `${cardTop}px`;
}

function clampCardWidth() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - CARD_MARGIN * 2, CARD_MIN_WIDTH);
  cardWidth = Math.min(Math.max(cardWidth, CARD_MIN_WIDTH), maxW);
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
  applyCardBox();
  const stageRect = canvasStage.getBoundingClientRect();
  const cardRect = problemCard.getBoundingClientRect();
  cardLeft = Math.max(CARD_MARGIN, (stageRect.width - cardRect.width) / 2);
  cardTop = Math.max(CARD_MARGIN, (stageRect.height - cardRect.height) / 2);
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

// ---- 가장자리 핸들로 창 너비(=확대/축소) 조절 ----

function setupResizeHandle(el) {
  const dir = el.dataset.dir; // 'e' | 'w'
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    problemCard.classList.add('resizing');
    const startX = e.clientX;
    const startW = cardWidth;
    const startLeft = cardLeft;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      if (dir === 'e') {
        cardWidth = Math.max(CARD_MIN_WIDTH, startW + dx);
      } else {
        const nextWidth = Math.max(CARD_MIN_WIDTH, startW - dx);
        cardLeft = startLeft - (nextWidth - startW);
        cardWidth = nextWidth;
      }
      clampCardWidth();
      applyCardBox();
      updateZoomLabel();
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

// ---- 확대/축소 (= 창 너비 조절) ----

let baseFitWidth = null; // 100% 기준 너비(px)

function computeFitWidth() {
  const stageRect = canvasStage.getBoundingClientRect();
  const maxW = Math.max(stageRect.width - CARD_MARGIN * 2, CARD_MIN_WIDTH);
  const naturalW = img.naturalWidth || maxW;
  return Math.min(naturalW, maxW, 760);
}

function updateZoomLabel() {
  if (!baseFitWidth) return;
  zoomLevelLabel.textContent = `${Math.round((cardWidth / baseFitWidth) * 100)}%`;
}

let zoomResizeTimer = null;

function setCardWidth(nextWidth) {
  cardWidth = baseFitWidth ? Math.min(nextWidth, baseFitWidth * 3) : nextWidth;
  clampCardWidth();
  applyCardBox();
  clampCardPosition();
  applyCardBox();
  updateZoomLabel();
  clearTimeout(zoomResizeTimer);
  zoomResizeTimer = setTimeout(resizeCanvas, 220);
}

zoomInBtn.addEventListener('click', () => {
  if (!baseFitWidth) return;
  setCardWidth(cardWidth + baseFitWidth * 0.2);
});
zoomOutBtn.addEventListener('click', () => {
  if (!baseFitWidth) return;
  setCardWidth(cardWidth - baseFitWidth * 0.2);
});

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
    if (img.naturalWidth) {
      baseFitWidth = computeFitWidth();
      cardWidth = baseFitWidth;
      centerCard();
      updateZoomLabel();
      resizeCanvas();
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
  sizeRange.min = tool === 'eraser' ? 10 : 1;
  if (tool === 'eraser' && Number(sizeRange.value) < 10) {
    sizeRange.value = 20;
  }
}

penBtn.addEventListener('click', () => setTool('pen'));
eraserBtn.addEventListener('click', () => setTool('eraser'));

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
  if (img.naturalWidth) {
    baseFitWidth = computeFitWidth();
  }
  clampCardWidth();
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
      baseFitWidth = computeFitWidth();
      cardWidth = baseFitWidth;
      centerCard();
      updateZoomLabel();
      resizeCanvas();
    };
  } catch (err) {
    document.getElementById('problemCardTitle').textContent = '서버에 연결할 수 없습니다.';
  }
}

setTool('pen');
centerCard();
loadProblem();
