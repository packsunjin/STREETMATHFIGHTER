// 저장된 풀이(획)를 사진 위에 다시 그려주는 뷰어.
// 획 좌표는 "사진 기준 0~1 비율"이고, 흰 여백에 쓴 획은 이 범위를 벗어난다.
// 그래서 사진만 그리면 여백에 쓴 필기가 잘린다 -> 획 전체를 감싸는 영역을 먼저
// 계산하고, 그 영역을 캔버스에 맞춰서 사진과 필기를 함께 그린다.
window.SMFWork = (function () {
  const PADDING = 0.02; // 획이 화면 끝에 딱 붙지 않도록 여유

  function computeBounds(work) {
    // 사진 영역(0~1)은 항상 포함한다. 필기가 사진 안에만 있어도 사진 전체는 보여야 함.
    let minX = 0;
    let minY = 0;
    let maxX = 1;
    let maxY = 1;

    (work.strokes || []).forEach((stroke) => {
      for (let i = 0; i < stroke.p.length; i += 2) {
        const x = stroke.p[i];
        const y = stroke.p[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    });

    return {
      minX: minX - PADDING,
      minY: minY - PADDING,
      maxX: maxX + PADDING,
      maxY: maxY + PADDING,
    };
  }

  /**
   * 캔버스에 사진 + 필기를 그린다.
   * @param {HTMLCanvasElement} canvas 그릴 캔버스(CSS 크기가 이미 정해져 있어야 함)
   * @param {HTMLImageElement} image 로드가 끝난 문제 사진
   * @param {object} work { v, strokes:[{c,w,e,p:[x,y,...]}] }
   */
  function render(canvas, image, work) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bounds = computeBounds(work);
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;

    // 사진의 가로세로 비율을 유지한 채로, 필기까지 전부 들어가도록 축소 비율을 잡는다.
    const photoAspect = (image.naturalHeight || 1) / (image.naturalWidth || 1);
    const boxW = canvas.width;
    const boxH = canvas.height;
    // 화면 1px당 "사진 폭 비율" 환산: x는 spanX, y는 spanY * photoAspect 만큼 차지
    const scale = Math.min(boxW / spanX, boxH / (spanY * photoAspect));

    const contentW = spanX * scale;
    const contentH = spanY * photoAspect * scale;
    const originX = (boxW - contentW) / 2 - bounds.minX * scale;
    const originY = (boxH - contentH) / 2 - bounds.minY * photoAspect * scale;

    const toPx = (x, y) => ({ x: originX + x * scale, y: originY + y * photoAspect * scale });

    // 사진은 (0,0)~(1,1) 자리에 그린다
    const topLeft = toPx(0, 0);
    const bottomRight = toPx(1, 1);
    ctx.drawImage(image, topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    (work.strokes || []).forEach((stroke) => {
      if (stroke.p.length < 2) return;
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
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  /** 저장된 풀이를 화면 위 오버레이로 띄운다. */
  async function open({ imageSrc, work, title, caption }) {
    const overlay = document.createElement('div');
    overlay.className = 'work-overlay';
    overlay.innerHTML = `
      <div class="work-panel" role="dialog" aria-modal="true">
        <div class="work-panel-head">
          <div>
            <div class="work-panel-title"></div>
            <div class="work-panel-caption"></div>
          </div>
          <button type="button" class="work-close" aria-label="닫기">✕</button>
        </div>
        <div class="work-canvas-wrap"><canvas class="work-canvas"></canvas></div>
      </div>`;
    overlay.querySelector('.work-panel-title').textContent = title || '내가 쓴 풀이';
    overlay.querySelector('.work-panel-caption').textContent = caption || '';
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.work-canvas');
    const close = () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    overlay.querySelector('.work-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    let image = null;
    const onResize = () => {
      if (image) render(canvas, image, work);
    };
    window.addEventListener('resize', onResize);

    try {
      image = await loadImage(imageSrc);
      render(canvas, image, work);
    } catch (err) {
      overlay.querySelector('.work-canvas-wrap').textContent = '사진을 불러오지 못했어.';
    }

    if (window.SMFAnim) SMFAnim.cardIn(overlay.querySelector('.work-panel'));
    return close;
  }

  return { render, open, loadImage };
})();
