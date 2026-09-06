/* 진행 화면 연출(애니메이션 + 소리).
 * Anime.js와 Motion을 쓰되, 둘 중 하나라도 없거나 사용자가 "동작 줄이기"를 켰으면
 * 애니메이션 없이 결과 상태만 남도록 만든다(연출이 빠져도 진행은 계속돼야 한다). */
window.SMFShowAnim = (function () {
  const hasAnime = typeof window.anime !== 'undefined';
  const hasMotion = typeof window.Motion !== 'undefined';
  const prefersReduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = hasAnime && hasMotion && !prefersReduced;

  const animate = hasAnime ? window.anime.animate : null;

  /* ---- 소리 ----
   * 브라우저 자동재생 정책 때문에 사용자가 화면을 한 번 누르기 전에는 소리가 안 난다.
   * 진행자가 어차피 버튼을 눌러 시작하므로, 첫 입력 때 오디오를 깨워둔다. */
  let audioCtx = null;

  function getAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function unlockAudio() {
    getAudio();
  }

  // 강당 스피커가 크게 잡혀 있거나 다른 행사와 겹칠 때를 위해 끌 수 있게 한다.
  let muted = false;

  function toggleMute() {
    muted = !muted;
    return muted;
  }

  /** [주파수, 시작(초), 길이(초)] 목록을 순서대로 울린다. */
  function tones(list, type = 'triangle', volume = 0.22) {
    if (muted) return;
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    list.forEach(([freq, at, dur]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + at);
      gain.gain.linearRampToValueAtTime(volume, now + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + at);
      osc.stop(now + at + dur + 0.02);
    });
  }

  const sounds = {
    start: () => tones([[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.28]]),
    tick: () => tones([[880, 0, 0.07]], 'square', 0.14),
    timesUp: () => tones([[300, 0, 0.25], [220, 0.25, 0.45]], 'sawtooth', 0.26),
    correct: () =>
      tones([[523, 0, 0.12], [659, 0.1, 0.12], [784, 0.2, 0.14], [1047, 0.32, 0.4]]),
    wrong: () => tones([[300, 0, 0.18], [240, 0.16, 0.36]], 'sawtooth', 0.24),
    reveal: () => tones([[392, 0, 0.14], [587, 0.14, 0.3]]),
  };

  /* ---- 화면 전환 ---- */
  // 전체 화면을 scale로 키우면, 그 동안 자식(캔버스/사진) 크기를 재는 코드가
  // 애니메이션 중간값을 읽어서 어긋난다. 그래서 페이드만 한다.
  function stageIn(el) {
    if (!el || !enabled) return;
    animate(el, { opacity: [0, 1] }, { duration: 0.28, ease: 'outQuad' });
  }

  /** 여러 요소를 차례로 등장시킨다. */
  function listIn(elements, each = 60) {
    if (!enabled || !elements.length) return;
    animate(
      elements,
      { opacity: [0, 1], y: [24, 0] },
      { duration: 0.4, delay: window.anime.stagger(each / 1000), ease: 'outQuad' }
    );
  }

  /** 버튼을 누를 때 살짝 눌리는 느낌. 터치 화면에서 반응이 있는지 확인시켜 준다. */
  function pressable(elements) {
    if (!enabled) return;
    const list = elements instanceof Element ? [elements] : Array.from(elements);
    list.forEach((el) => {
      el.addEventListener('pointerdown', () => {
        animate(el, { scale: 0.96 }, { duration: 0.09, ease: 'outQuad' });
      });
      const back = () => animate(el, { scale: 1 }, { duration: 0.18, ease: 'outBack' });
      el.addEventListener('pointerup', back);
      el.addEventListener('pointerleave', back);
      el.addEventListener('pointercancel', back);
    });
  }

  /** 남은 시간이 얼마 안 남았을 때 타이머를 한 번 크게 뛰게 한다. */
  function timerBeat(el) {
    if (!el || !enabled) return;
    animate(el, { scale: [1, 1.14, 1] }, { duration: 0.36, ease: 'outQuad' });
  }

  /** 정답 숫자가 쾅 하고 등장. */
  function slam(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [2.2, 1], opacity: [0, 1], rotate: [-6, 0] },
      { type: 'spring', stiffness: 220, damping: 16 }
    );
  }

  function shake(el) {
    if (!el || !enabled) return;
    animate(el, { x: [0, -18, 16, -12, 8, 0] }, { duration: 0.5, ease: 'outQuad' });
  }

  /* ---- 3, 2, 1 카운트다운 ---- */
  const COUNTDOWN_STYLE =
    'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
    'background:#fff;font-size:40vmin;font-weight:900;color:#111;font-family:inherit';

  /** 3 → 2 → 1 → 시작! 을 띄우고 끝나면 resolve. 연출이 꺼져 있으면 바로 resolve. */
  function countdown(from = 3) {
    sounds.start();
    if (!enabled) return Promise.resolve();

    return new Promise((resolve) => {
      const layer = document.createElement('div');
      layer.setAttribute('style', COUNTDOWN_STYLE);
      document.body.appendChild(layer);

      // 어떤 이유로든(애니메이션 실패 등) 레이어가 남으면 화면을 덮어 진행이 막힌다.
      // 그래서 정리는 타이머로 보장하고, 두 번 불려도 안전하게 만든다.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.remove();
        resolve();
      };

      let n = from;
      const step = () => {
        if (n <= 0) {
          layer.textContent = '시작!';
          animate(layer, { opacity: [1, 0] }, { duration: 0.45, ease: 'outQuad' });
          setTimeout(finish, 500);
          return;
        }
        layer.textContent = String(n);
        sounds.tick();
        animate(
          layer,
          { scale: [1.6, 1], opacity: [0, 1] },
          { duration: 0.3, ease: 'outQuad' }
        );
        n -= 1;
        setTimeout(step, 750);
      };
      step();
    });
  }

  /* ---- 축하 색종이 ---- */
  const CONFETTI_COLORS = ['#e0393e', '#d97706', '#16a34a', '#1d4ed8', '#111111'];

  function confetti(count = 40) {
    if (!enabled) return;
    const layer = document.createElement('div');
    layer.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:40;pointer-events:none;overflow:hidden'
    );
    document.body.appendChild(layer);

    const pieces = [];
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('div');
      const size = 10 + Math.random() * 14;
      piece.setAttribute(
        'style',
        `position:absolute;top:-6vh;left:${Math.random() * 100}%;width:${size}px;height:${
          size * 0.5
        }px;background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};border-radius:2px`
      );
      layer.appendChild(piece);
      pieces.push(piece);
    }

    const DURATION_MS = 2400;
    animate(
      pieces,
      { y: `${window.innerHeight + 100}px`, rotate: () => 360 + Math.random() * 720 },
      {
        duration: DURATION_MS / 1000,
        delay: window.anime.stagger(0.03),
        ease: 'linear',
      }
    );
    // 애니메이션 완료 콜백에 기대지 않고 직접 치운다. 안 치우면 축하할 때마다
    // 레이어가 화면에 쌓인다.
    setTimeout(() => layer.remove(), DURATION_MS + count * 30 + 200);
  }

  return {
    enabled,
    sounds,
    toggleMute,
    unlockAudio,
    stageIn,
    listIn,
    pressable,
    timerBeat,
    slam,
    shake,
    countdown,
    confetti,
  };
})();
