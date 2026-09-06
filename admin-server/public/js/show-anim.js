/* 진행 화면 연출.
 *
 * 강당 앞 65~86인치 화면이고 뒤에는 학생들이 앉아 있다. 얌전한 페이드는
 * 뒤에서 보이지도 않고 아무 반응도 못 끌어낸다. 그래서 전부 크게 움직인다.
 *
 * Anime.js로 타임라인을 짜고, 소리와 박자를 맞춘다.
 * 라이브러리가 없거나 사용자가 "동작 줄이기"를 켰으면 연출 없이 결과 상태만
 * 남는다(연출이 빠져도 행사 진행은 계속돼야 한다).
 */
window.SMFShowAnim = (function () {
  const hasAnime = typeof window.anime !== 'undefined';
  const prefersReduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = hasAnime && !prefersReduced;

  const animate = hasAnime ? window.anime.animate : null;
  const createTimeline = hasAnime ? window.anime.createTimeline : null;
  const stagger = hasAnime ? window.anime.stagger : null;

  /* ================= 소리 =================
   * 브라우저 자동재생 정책 때문에 사용자가 화면을 한 번 누르기 전에는 소리가 안 난다.
   * 진행자가 어차피 버튼을 눌러 시작하므로, 첫 입력 때 오디오를 깨워둔다. */
  let audioCtx = null;
  let muted = false;

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

  /** 낮게 쿵 하고 울리는 소리. 큰 연출의 착지 지점에 쓴다. */
  function boom(volume = 0.3) {
    if (muted) return;
    const ctx = getAudio();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.35);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }

  const sounds = {
    start: () => tones([[523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.28]]),
    tick: () => tones([[880, 0, 0.07]], 'square', 0.16),
    countdown: () => tones([[440, 0, 0.12]], 'square', 0.2),
    timesUp: () => {
      tones([[300, 0, 0.25], [220, 0.25, 0.45]], 'sawtooth', 0.26);
      boom(0.25);
    },
    correct: () => {
      tones([[523, 0, 0.14], [659, 0.12, 0.14], [784, 0.24, 0.16], [1047, 0.36, 0.5]]);
      boom(0.22);
    },
    wrong: () => {
      tones([[300, 0, 0.18], [240, 0.16, 0.4]], 'sawtooth', 0.26);
      boom(0.2);
    },
    reveal: () => {
      tones([[392, 0, 0.1], [523, 0.1, 0.1], [784, 0.2, 0.35]]);
      boom(0.28);
    },
  };

  /* ================= 화면 전환 =================
   * 전체 화면을 scale로 키우면 그 동안 자식(캔버스/사진) 크기를 재는 코드가
   * 애니메이션 중간값을 읽어서 어긋난다. 그래서 이동/투명도만 쓴다. */
  function stageIn(el) {
    if (!el || !enabled) return;

    // 안에 있는 것들이 아래에서 차례로 밀려 올라온다.
    const items = el.querySelectorAll(
      '.show-logo, .show-tagline, .idle-actions > *, .stage-title, .pick-card, ' +
        '.center-block > *, .choose-row'
    );

    animate(el, { opacity: [0, 1] }, { duration: 0.18, ease: 'outQuad' });

    if (items.length) {
      animate(
        items,
        { opacity: [0, 1], y: [60, 0], scale: [0.9, 1] },
        {
          duration: 0.55,
          delay: stagger(0.045),
          ease: 'out(3)',
        }
      );
    }
  }

  /** 여러 요소를 차례로 등장시킨다. */
  function listIn(elements, each = 45) {
    if (!enabled || !elements.length) return;
    animate(
      elements,
      { opacity: [0, 1], x: [-40, 0] },
      { duration: 0.45, delay: stagger(each / 1000), ease: 'out(3)' }
    );
  }

  /** 버튼을 누를 때 눌리는 느낌. 터치 화면에서 반응이 있는지 확인시켜 준다. */
  function pressable(elements) {
    if (!enabled) return;
    const list = elements instanceof Element ? [elements] : Array.from(elements);
    list.forEach((el) => {
      el.addEventListener('pointerdown', () => {
        animate(el, { scale: 0.94 }, { duration: 0.08, ease: 'outQuad' });
      });
      const back = () => animate(el, { scale: 1 }, { duration: 0.4, ease: 'outElastic(1, .5)' });
      el.addEventListener('pointerup', back);
      el.addEventListener('pointerleave', back);
      el.addEventListener('pointercancel', back);
    });
  }

  /* ================= 공용 연출 조각 ================= */

  const layerStyle =
    'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;' +
    'pointer-events:none;font-family:inherit';

  function makeLayer(extra = '', name = 'fx') {
    const layer = document.createElement('div');
    layer.className = `fx fx-${name}`;
    layer.setAttribute('style', layerStyle + extra);
    document.body.appendChild(layer);
    return layer;
  }

  /** 화면 전체가 한 번 번쩍인다. 정답/오답처럼 결과가 갈리는 순간에. */
  function flash(color, duration = 0.5) {
    if (!enabled) return;
    const layer = makeLayer(`;background:${color};opacity:0`, 'flash');
    animate(layer, { opacity: [0, 0.75, 0] }, { duration, ease: 'outQuad' });
    setTimeout(() => layer.remove(), duration * 1000 + 100);
  }

  /** 가운데에서 링이 퍼져나간다. */
  function ring(color, count = 3) {
    if (!enabled) return;
    const layer = makeLayer(';overflow:hidden', 'ring');
    const rings = [];

    for (let i = 0; i < count; i += 1) {
      const r = document.createElement('div');
      r.setAttribute(
        'style',
        `position:absolute;width:20vmin;height:20vmin;border-radius:50%;` +
          `border:1.2vmin solid ${color};opacity:0`
      );
      layer.appendChild(r);
      rings.push(r);
    }

    animate(
      rings,
      { scale: [0.2, 6], opacity: [0.9, 0] },
      { duration: 1.1, delay: stagger(0.14), ease: 'out(3)' }
    );
    setTimeout(() => layer.remove(), 1600);
  }

  /** 화면을 통째로 흔든다. 시간 종료나 오답처럼 "쿵" 하는 순간에. */
  function shakeScreen(strength = 24) {
    if (!enabled) return;
    animate(
      document.body,
      { x: [0, -strength, strength * 0.8, -strength * 0.5, strength * 0.3, 0] },
      { duration: 0.55, ease: 'outQuad' }
    );
  }

  /* ================= 타이머 ================= */

  /** 남은 시간이 얼마 안 남았을 때 타이머가 크게 뛴다. */
  function timerBeat(el) {
    if (!el || !enabled) return;
    animate(el, { scale: [1, 1.35, 1] }, { duration: 0.42, ease: 'out(4)' });
  }

  /** 마지막 10초 동안 화면 가장자리가 붉게 맥동한다(뒤에서도 보이게). */
  let urgentLayer = null;

  function urgentOn() {
    if (!enabled || urgentLayer) return;
    urgentLayer = makeLayer(
      ';z-index:20;box-shadow:inset 0 0 12vmin 3vmin rgba(224,57,62,.55);opacity:0',
      'urgent'
    );
    animate(urgentLayer, { opacity: [0.2, 1] }, { duration: 0.5, loop: true, alternate: true });
  }

  function urgentOff() {
    if (urgentLayer) {
      urgentLayer.remove();
      urgentLayer = null;
    }
  }

  /* ================= 정답 공개 ================= */

  /** 정답이 위에서 쿵 떨어진다. */
  function slam(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [3.2, 1], opacity: [0, 1], rotate: [-10, 0] },
      { duration: 0.7, ease: 'out(5)' }
    );
    setTimeout(() => {
      shakeScreen(18);
      ring('#111111', 2);
    }, 320);
  }

  function shake(el) {
    if (!el || !enabled) return;
    animate(el, { x: [0, -24, 22, -16, 10, 0] }, { duration: 0.5, ease: 'outQuad' });
  }

  /** 두구두구. 정답을 까기 직전의 뜸. 퀴즈쇼에서 제일 중요한 2초다. */
  function drumroll(ms = 1400) {
    if (muted) return;
    const ctx = getAudio();
    if (!ctx) return;

    const now = ctx.currentTime;
    const seconds = ms / 1000;
    // 점점 빨라지는 북소리
    let t = 0;
    let gap = 0.11;
    while (t < seconds) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(120, now + t);
      osc.frequency.exponentialRampToValueAtTime(60, now + t + 0.05);
      gain.gain.setValueAtTime(0.18, now + t);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.07);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + 0.08);
      t += gap;
      gap = Math.max(gap * 0.87, 0.035); // 갈수록 촘촘하게
    }
  }

  /**
   * "정답은..." 하고 뜸을 들인 뒤 resolve.
   * 화면에는 세 점이 차례로 커졌다 작아지고, 북소리가 점점 빨라진다.
   */
  function suspense(labelEl, ms = 1400) {
    drumroll(ms);
    if (!enabled) return Promise.resolve();

    const dots = document.createElement('span');
    dots.className = 'suspense-dots';
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'suspense-dot';
      dots.appendChild(dot);
    }
    if (labelEl) labelEl.appendChild(dots);

    animate(
      dots.querySelectorAll('.suspense-dot'),
      { scale: [0.5, 1.6], opacity: [0.3, 1] },
      { duration: 0.36, delay: stagger(0.12), loop: true, alternate: true }
    );

    // 뜸 들이는 동안 화면이 잘게 떨린다.
    // body를 흔들면 고정 배치(전체화면/음소거 버튼)까지 끌려다니므로 무대만 흔든다.
    const stage = labelEl && labelEl.closest ? labelEl.closest('.stage') : null;
    if (stage) {
      animate(stage, { x: [0, -3, 3, 0] }, { duration: 0.12, loop: Math.round(ms / 120) });
    }

    return new Promise((resolve) =>
      setTimeout(() => {
        dots.remove();
        resolve();
      }, ms)
    );
  }

  /** 난이도 배지가 회전하며 쿵 박힌다. */
  function badgeSlam(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [4, 1], rotate: [-360, 0], opacity: [0, 1] },
      { duration: 0.85, ease: 'out(5)' }
    );
    setTimeout(() => {
      boom(0.2);
      shakeScreen(10);
    }, 420);
  }

  /** 타이머가 위에서 떨어지며 자리를 잡는다. */
  function timerIn(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [2.2, 1], y: [-40, 0], opacity: [0, 1] },
      { duration: 0.6, ease: 'out(4)' }
    );
  }

  /* ================= 3, 2, 1 카운트다운 ================= */

  const NUMBER_STYLE =
    'position:absolute;font-size:52vmin;font-weight:900;color:#111;line-height:1;' +
    'font-family:inherit;opacity:0';

  /**
   * 3 → 2 → 1 → 시작! 을 화면 가득 띄우고 끝나면 resolve.
   * 숫자마다 줄어드는 링이 같이 돌아서 "곧 시작한다"가 멀리서도 읽힌다.
   */
  function countdown(from = 3) {
    sounds.start();
    if (!enabled) return Promise.resolve();

    return new Promise((resolve) => {
      const layer = makeLayer(';background:#fff;z-index:70', 'countdown');

      // 어떤 이유로든 레이어가 남으면 화면을 덮어 진행이 막힌다.
      // 정리는 타이머로 보장하고, 두 번 불려도 안전하게 만든다.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.remove();
        resolve();
      };

      const STEP_MS = 800;

      const showNumber = (text, index) => {
        const num = document.createElement('div');
        num.setAttribute('style', NUMBER_STYLE);
        num.textContent = text;
        layer.appendChild(num);

        const circle = document.createElement('div');
        circle.setAttribute(
          'style',
          'position:absolute;width:70vmin;height:70vmin;border-radius:50%;' +
            'border:1.6vmin solid #111;opacity:0'
        );
        layer.appendChild(circle);

        sounds.countdown();

        animate(
          num,
          { scale: [2.4, 1], opacity: [0, 1, 1, 0], rotate: [index % 2 ? 12 : -12, 0] },
          { duration: STEP_MS / 1000, ease: 'out(4)' }
        );
        animate(
          circle,
          { scale: [1.6, 0.6], opacity: [0.9, 0] },
          { duration: STEP_MS / 1000, ease: 'out(2)' }
        );

        setTimeout(() => {
          num.remove();
          circle.remove();
        }, STEP_MS);
      };

      let n = from;
      let index = 0;

      const step = () => {
        if (n <= 0) {
          const go = document.createElement('div');
          go.setAttribute('style', NUMBER_STYLE + ';font-size:26vmin');
          go.textContent = '시작!';
          layer.appendChild(go);

          boom(0.32);
          animate(go, { scale: [0.4, 1.15], opacity: [0, 1] }, { duration: 0.35, ease: 'out(5)' });
          animate(layer, { opacity: [1, 0] }, { duration: 0.45, delay: 0.35, ease: 'outQuad' });
          setTimeout(finish, 850);
          return;
        }

        showNumber(String(n), index);
        n -= 1;
        index += 1;
        setTimeout(step, STEP_MS);
      };

      step();
    });
  }

  /* ================= 축하 ================= */

  const CONFETTI_COLORS = ['#e0393e', '#d97706', '#16a34a', '#1d4ed8', '#111111', '#7c3aed'];

  /** 가운데에서 색종이가 터져 나와 사방으로 흩어진다. */
  function confetti(count = 90) {
    if (!enabled) return;
    const layer = makeLayer(';z-index:50;overflow:hidden', 'confetti');

    const pieces = [];
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('div');
      const size = 12 + Math.random() * 20;
      piece.className = 'fx-piece';
      piece.setAttribute(
        'style',
        `position:absolute;left:50%;top:45%;width:${size}px;height:${size * (0.35 + Math.random() * 0.5)}px;` +
          `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};border-radius:2px`
      );
      layer.appendChild(piece);
      pieces.push(piece);
    }

    const DURATION_MS = 2600;

    // 터지듯 사방으로 흩어졌다가 아래로 떨어진다
    animate(
      pieces,
      {
        x: () => (Math.random() - 0.5) * window.innerWidth * 1.4,
        y: () => (Math.random() - 0.65) * window.innerHeight * 1.3,
        rotate: () => (Math.random() - 0.5) * 1440,
        scale: [() => 0.4 + Math.random(), 0.6],
        opacity: [1, 1, 0],
      },
      { duration: DURATION_MS / 1000, ease: 'out(2)' }
    );

    // 애니메이션 완료 콜백에 기대지 않고 직접 치운다.
    // 안 치우면 축하할 때마다 레이어가 화면에 쌓인다.
    setTimeout(() => layer.remove(), DURATION_MS + 300);
  }

  /** 정답 순간 전체 연출: 초록 번쩍 + 링 + 색종이 + 흔들림. */
  function celebrate() {
    if (!enabled) return;
    flash('#16a34a', 0.55);
    ring('#16a34a', 4);
    shakeScreen(16);
    confetti();
  }

  /** 오답 순간: 붉은 번쩍 + 흔들림. */
  function reject() {
    if (!enabled) return;
    flash('#e0393e', 0.45);
    shakeScreen(26);
  }

  /** 트로피가 튀어 오르고 글자가 뒤따라 커진다. */
  function trophyIn(markEl, textEl) {
    if (!enabled) return;
    if (markEl) {
      animate(
        markEl,
        { scale: [0, 1], rotate: [-180, 0], y: [-200, 0] },
        { duration: 0.9, ease: 'out(4)' }
      );
    }
    if (textEl) {
      animate(
        textEl,
        { scale: [0.3, 1], opacity: [0, 1] },
        { duration: 0.6, delay: 0.25, ease: 'out(5)' }
      );
    }
  }

  /** 문제 사진이 확 커지며 등장. */
  function photoIn(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [0.82, 1], opacity: [0, 1] },
      { duration: 0.7, ease: 'out(4)' }
    );
  }

  return {
    enabled,
    sounds,
    boom,
    toggleMute,
    unlockAudio,
    stageIn,
    listIn,
    pressable,
    timerBeat,
    urgentOn,
    urgentOff,
    slam,
    shake,
    shakeScreen,
    flash,
    ring,
    countdown,
    drumroll,
    suspense,
    badgeSlam,
    timerIn,
    confetti,
    celebrate,
    reject,
    trophyIn,
    photoIn,
  };
})();
