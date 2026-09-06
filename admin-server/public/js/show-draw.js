/* 전자칠판 필기 엔진.
 *
 * 두 가지가 핵심이다.
 *
 * 1) 벡터로 저장하고 다시 그린다.
 *    획을 비트맵에 바로 찍고 끝내면, 화면 크기가 바뀌거나 고해상도 보정이 들어갈 때
 *    이미 찍힌 픽셀을 늘리게 되어 선이 뭉개진다. 그래서 점 좌표만 들고 있다가
 *    매번 처음부터 다시 그린다.
 *
 * 2) 좌표는 "판 가로폭 대비 비율"로 저장한다.
 *    x도 y도 전부 가로폭으로 나눈다. 가로/세로를 따로 나누면 화면 비율이 바뀔 때
 *    글씨가 찌그러지는데, 같은 값으로 나누면 비율이 유지된 채 크기만 변한다.
 */
window.SMFDraw = (function () {
  const PEN_MEMORY_MS = 2000; // 펜을 쓴 직후 이 시간 동안은 손바닥(터치)을 무시

  let board = null;
  let canvas = null;
  let ctx = null;

  let strokes = [];
  let current = null;
  let drawing = false;
  let activePointerId = null;

  let color = '#111111';
  let eraser = false;
  let dpr = 1;
  let boardWidth = 1;

  // 전자칠판은 펜으로 쓰다가 손바닥이 화면에 닿는 일이 잦다. 펜이 한 번이라도
  // 쓰였으면 그 뒤 잠깐은 터치 입력을 필기로 받지 않는다(버튼 조작은 영향 없음).
  let lastPenAt = 0;

  const PEN_WIDTH_FRAC = 0.0045; // 판 가로폭 대비. 강당 뒤에서도 보이도록 굵게.
  const ERASER_WIDTH_FRAC = 0.05;

  let onChange = () => {};

  function toFrac(clientX, clientY) {
    const rect = board.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / (rect.width || 1),
      // y도 가로폭으로 나눈다(위 주석 2번 참고)
      y: (clientY - rect.top) / (rect.width || 1),
    };
  }

  function toPx(point) {
    return { x: point.x * boardWidth * dpr, y: point.y * boardWidth * dpr };
  }

  function drawStroke(stroke) {
    if (!stroke.points.length) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke.widthFrac * boardWidth * dpr;
    ctx.strokeStyle = stroke.color;
    ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';

    ctx.beginPath();
    const first = toPx(stroke.points[0]);
    ctx.moveTo(first.x, first.y);
    if (stroke.points.length === 1) {
      // 톡 찍은 점도 보이도록 아주 짧은 선으로
      ctx.lineTo(first.x + 0.01, first.y + 0.01);
    } else {
      for (let i = 1; i < stroke.points.length; i += 1) {
        const p = toPx(stroke.points[i]);
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.stroke();
  }

  function redraw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach(drawStroke);
    ctx.globalCompositeOperation = 'source-over';
  }

  function resize() {
    // getBoundingClientRect는 transform(애니메이션 중 scale 등)의 영향을 받아서
    // 잘못된 값이 잡힐 수 있다. 레이아웃상의 크기인 offset*를 쓴다.
    const width = board.offsetWidth;
    const height = board.offsetHeight;
    if (width < 1 || height < 1) return;

    dpr = window.devicePixelRatio || 1;
    boardWidth = width;
    canvas.width = Math.max(Math.round(width * dpr), 1);
    canvas.height = Math.max(Math.round(height * dpr), 1);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    redraw();
  }

  /** 이 포인터를 필기로 받아도 되나? (손바닥 걸러내기) */
  function acceptsPointer(event) {
    if (event.pointerType === 'pen') {
      lastPenAt = Date.now();
      return true;
    }
    if (event.pointerType === 'touch') {
      return Date.now() - lastPenAt > PEN_MEMORY_MS;
    }
    return true; // mouse
  }

  function onPointerDown(event) {
    if (drawing) return; // 멀티터치로 획이 섞이지 않게 한 번에 하나만
    if (!acceptsPointer(event)) return;

    event.preventDefault();
    drawing = true;
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);

    current = {
      points: [toFrac(event.clientX, event.clientY)],
      color: eraser ? '#000000' : color,
      widthFrac: eraser ? ERASER_WIDTH_FRAC : PEN_WIDTH_FRAC,
      eraser,
    };
    drawStroke(current);
  }

  function onPointerMove(event) {
    if (!drawing || event.pointerId !== activePointerId) return;
    event.preventDefault();

    const point = toFrac(event.clientX, event.clientY);
    const prev = current.points[current.points.length - 1];
    current.points.push(point);

    // 진행 중인 획은 전체를 다시 그리지 않고 마지막 선분만 이어 붙인다(반응 속도).
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = current.widthFrac * boardWidth * dpr;
    ctx.strokeStyle = current.color;
    ctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over';
    const a = toPx(prev);
    const b = toPx(point);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function onPointerUp(event) {
    if (!drawing || event.pointerId !== activePointerId) return;
    drawing = false;
    activePointerId = null;
    if (current && current.points.length) strokes.push(current);
    current = null;
    onChange();
  }

  function init(options) {
    board = options.board;
    canvas = options.canvas;
    ctx = canvas.getContext('2d');
    onChange = options.onChange || (() => {});

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    window.addEventListener('resize', resize);
    resize();
  }

  function setColor(next) {
    color = next;
    eraser = false;
  }

  function setEraser(on) {
    eraser = Boolean(on);
  }

  function isEraser() {
    return eraser;
  }

  function undo() {
    strokes.pop();
    redraw();
    onChange();
  }

  function clear() {
    strokes = [];
    current = null;
    redraw();
    onChange();
  }

  function isEmpty() {
    return strokes.length === 0;
  }

  /** 저장용으로 줄인 형태. 좌표는 소수점 4자리, 너무 촘촘한 점은 버린다. */
  function serialize() {
    const MIN_GAP = 0.0025;
    const out = [];
    strokes.forEach((stroke) => {
      const flat = [];
      let lastX = null;
      let lastY = null;
      stroke.points.forEach((point, index) => {
        const isEdge = index === 0 || index === stroke.points.length - 1;
        if (!isEdge && lastX !== null && Math.hypot(point.x - lastX, point.y - lastY) < MIN_GAP) return;
        lastX = point.x;
        lastY = point.y;
        flat.push(Number(point.x.toFixed(4)), Number(point.y.toFixed(4)));
      });
      if (flat.length === 2) flat.push(flat[0], flat[1]);
      if (flat.length >= 2) {
        out.push({ c: stroke.color, w: Number(stroke.widthFrac.toFixed(6)), e: stroke.eraser ? 1 : 0, p: flat });
      }
    });
    return out.length ? { v: 1, strokes: out } : null;
  }

  return { init, resize, setColor, setEraser, isEraser, undo, clear, isEmpty, serialize };
})();
