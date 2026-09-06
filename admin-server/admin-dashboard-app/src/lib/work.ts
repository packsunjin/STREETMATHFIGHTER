// 학생이 사진 위에 쓴 풀이를 다시 그리는 로직.
// 좌표는 "사진 기준 0~1 비율"이고, 사진 옆 흰 여백에 쓴 획은 이 범위를 벗어난다.
// 그래서 사진만 그리면 여백 필기가 잘린다 -> 획 전체를 감싸는 영역을 먼저 계산한다.
// (학생 화면의 main-server/public/js/work-view.js와 같은 규칙)

export interface WorkStroke {
  c: string;
  w: number;
  e: 0 | 1;
  p: number[];
}

export interface Work {
  v: number;
  strokes: WorkStroke[];
}

export interface AttemptSummary {
  id: number;
  problemId: number;
  studentKey: string;
  studentName: string | null;
  correct: boolean;
  submittedAnswer: string | null;
  durationMs: number | null;
  createdAt: string;
  title: string;
  difficulty: string;
  unit: string | null;
  imageUrl: string;
}

export interface AttemptDetail extends AttemptSummary {
  work: Work | null;
}

const PADDING = 0.02;

function computeBounds(work: Work) {
  let minX = 0;
  let minY = 0;
  let maxX = 1;
  let maxY = 1;
  for (const stroke of work.strokes) {
    for (let i = 0; i < stroke.p.length; i += 2) {
      const x = stroke.p[i];
      const y = stroke.p[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX: minX - PADDING, minY: minY - PADDING, maxX: maxX + PADDING, maxY: maxY + PADDING };
}

export function renderWork(canvas: HTMLCanvasElement, image: HTMLImageElement, work: Work) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const bounds = computeBounds(work);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const photoAspect = (image.naturalHeight || 1) / (image.naturalWidth || 1);

  const scale = Math.min(canvas.width / spanX, canvas.height / (spanY * photoAspect));
  const contentW = spanX * scale;
  const contentH = spanY * photoAspect * scale;
  const originX = (canvas.width - contentW) / 2 - bounds.minX * scale;
  const originY = (canvas.height - contentH) / 2 - bounds.minY * photoAspect * scale;
  const toPx = (x: number, y: number) => ({
    x: originX + x * scale,
    y: originY + y * photoAspect * scale,
  });

  const topLeft = toPx(0, 0);
  const bottomRight = toPx(1, 1);
  ctx.drawImage(image, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of work.strokes) {
    if (stroke.p.length < 2) continue;
    ctx.globalCompositeOperation = stroke.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.c;
    ctx.lineWidth = Math.max(stroke.w * scale, 0.5);
    ctx.beginPath();
    const start = toPx(stroke.p[0], stroke.p[1]);
    ctx.moveTo(start.x, start.y);
    if (stroke.p.length === 2) {
      ctx.lineTo(start.x + 0.01, start.y + 0.01);
    } else {
      for (let i = 2; i < stroke.p.length; i += 2) {
        const point = toPx(stroke.p[i], stroke.p[i + 1]);
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    image.src = src;
  });
}

export function formatDuration(ms: number | null): string {
  if (!ms || ms < 0) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
