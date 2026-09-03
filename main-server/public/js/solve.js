const params = new URLSearchParams(window.location.search);
const problemId = params.get('id');

const img = document.getElementById('problemImage');
const canvas = document.getElementById('drawCanvas');
const ctx = canvas.getContext('2d');
const frame = document.getElementById('canvasFrame');

const penBtn = document.getElementById('penBtn');
const eraserBtn = document.getElementById('eraserBtn');
const clearBtn = document.getElementById('clearBtn');
const sizeRange = document.getElementById('sizeRange');
const backBtn = document.getElementById('backBtn');
const descriptionToggleWrap = document.getElementById('descriptionToggleWrap');
const descriptionToggle = document.getElementById('descriptionToggle');
const descriptionBox = document.getElementById('descriptionBox');

let tool = 'pen'; // 'pen' | 'eraser'
let drawing = false;
let lastPoint = null;

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

window.addEventListener('resize', resizeCanvas);

descriptionToggle.addEventListener('click', () => {
  const visible = descriptionBox.style.display === 'block';
  descriptionBox.style.display = visible ? 'none' : 'block';
  descriptionToggle.textContent = visible ? '설명 / 해설 보기 ▾' : '설명 / 해설 닫기 ▴';
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

    const badge = document.getElementById('difficultyBadge');
    badge.textContent = problem.difficulty;
    badge.classList.add(problem.difficulty);
    document.getElementById('problemCardTitle').textContent = problem.title;

    if (problem.description) {
      descriptionToggleWrap.style.display = 'block';
      descriptionBox.textContent = problem.description;
    }

    img.src = problem.imageUrl;
    img.onload = () => {
      resizeCanvas();
    };
  } catch (err) {
    document.getElementById('problemCardTitle').textContent = '서버에 연결할 수 없습니다.';
  }
}

setTool('pen');
loadProblem();
