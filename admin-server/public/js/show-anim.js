/* 진행 화면 연출.
 *
 * 강당 앞 65~86인치 화면이고 뒤에는 학생들이 앉아 있다. 얌전한 페이드는
 * 뒤에서 보이지도 않고 아무 반응도 못 끌어낸다. 그래서 크게 움직인다.
 *
 * 다만 이 화면의 생김새는 완전한 평면이다(Modernist 시안). 그래서 움직임도
 * 평면에서만 만든다 — 밀어내기, 페이드, 차오르는 막대, 딱 붙는 등장.
 * 회전도, 원근도, 깊이도 쓰지 않는다. 그림자와 둥근 모서리도 없다.
 *
 * 무게는 스프링이 아니라 가속 곡선과 순서로 낸다. 여러 개가 한꺼번에 뜨는
 * 대신 아주 짧은 간격으로 차례로 앉으면, 평면에서도 덩어리가 느껴진다.
 *
 * 라이브러리가 없으면 연출 없이 결과 상태만 남는다(연출이 빠져도 행사는 계속돼야 한다).
 */
window.SMFShowAnim = (function () {
  // 운영체제의 "동작 줄이기" 설정은 일부러 보지 않는다.
  // 이건 개인이 쓰는 앱이 아니라 강당 무대 화면이고, 연출이 곧 기능이다.
  // 전자칠판에 그 설정이 켜져 있으면(윈도우/안드로이드에서 흔하다) 연출이
  // 통째로 꺼져서 "애니메이션이 하나도 없는" 화면이 된다. 실제로 그랬다.
  // 소리는 화면의 음소거 버튼으로 끌 수 있다.
  const hasAnime = typeof window.anime !== 'undefined';
  const enabled = hasAnime;

  const animate = hasAnime ? window.anime.animate : null;
  const stagger = hasAnime ? window.anime.stagger : null;

  /* ================= 움직임의 기본 성질 =================
   * 평면 디자인이라 튕김(overshoot)이 없다. 튕기면 "떠 있는" 것처럼 보이는데
   * 이 화면은 아무것도 떠 있으면 안 된다. 전부 한 번에 앉는 곡선만 쓴다. */
  const EASE_IN = 'outQuint'; // 들어올 때: 빠르게 왔다가 조용히 멎는다
  const EASE_OUT = 'inQuad'; //  나갈 때: 미련 없이 빠진다
  const IN_MS = 380;
  const STEP_MS = 45; // 차례로 앉는 간격

  /** 매번 똑같은 간격으로 움직이면 기계가 움직이는 것처럼 보인다. 살짝 흐트러뜨린다. */
  function jitter(amount) {
    return (Math.random() - 0.5) * 2 * amount;
  }

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
    /** 채점 막대가 한 단계 넘어갈 때 나는 짧은 소리. */
    grade: () => tones([[720, 0, 0.05]], 'square', 0.12),
    /** 화면이 넘어갈 때 스치는 소리. 전환이 있었다는 걸 귀로도 알린다. */
    whoosh: () => tones([[180, 0, 0.05], [420, 0.05, 0.08], [140, 0.14, 0.16]], 'sine', 0.1),
    /** 정답 축하 팡파르. 소리가 커야 강당이 같이 터진다. */
    fanfare: () => {
      tones(
        [
          [523, 0, 0.12], [523, 0.12, 0.1], [523, 0.24, 0.1], [698, 0.36, 0.34],
          [659, 0.7, 0.12], [698, 0.82, 0.12], [880, 0.94, 0.55],
        ],
        'triangle',
        0.24
      );
      boom(0.3);
    },
  };

  /* ================= 글자 단위 등장 =================
   * 한 덩어리로 밀려 올라오는 것과, 글자가 차례로 일어서는 것은 인상이 아주 다르다.
   * 제목처럼 "읽히는 순간"이 중요한 곳에만 쓴다. */
  function splitChars(el) {
    if (!el) return [];
    // 이미 쪼개 뒀으면 그대로 쓴다(다시 쪼개면 span 안에 span이 겹친다).
    // 단, 그 사이에 textContent로 글자를 갈아끼웠으면 조각이 사라졌으므로
    // 표시만 믿지 말고 실제로 남아 있는지 본다(안 그러면 조용히 연출이 빠진다).
    if (el.dataset.split === '1' && el.querySelector('.ch')) {
      return Array.from(el.querySelectorAll('.ch'));
    }

    const text = el.textContent;
    el.dataset.plain = text;
    el.textContent = '';
    const spans = [];
    for (const char of text) {
      const span = document.createElement('span');
      span.className = 'ch';
      span.textContent = char;
      el.appendChild(span);
      spans.push(span);
    }
    el.dataset.split = '1';
    return spans;
  }

  /** 쪼갠 글자를 원래 한 덩어리 문자열로 되돌린다(글자를 바꿔 넣기 전에 부른다). */
  function unsplit(el) {
    if (!el || el.dataset.split !== '1') return;
    el.textContent = el.dataset.plain || el.textContent;
    delete el.dataset.split;
    delete el.dataset.plain;
  }

  /**
   * 글자가 아래에서 하나씩 올라온다.
   * 요소 하나든 여러 줄이든 받는다. 줄을 따로 넘겨야 하는 이유는,
   * 한 요소의 textContent를 통째로 쪼개면 줄바꿈이 사라지기 때문이다.
   */
  function splitIn(target, each = 0.03) {
    if (!target || !enabled) return;
    const els = target instanceof Element ? [target] : Array.from(target);
    const chars = [];
    els.forEach((el) => chars.push(...splitChars(el)));
    if (!chars.length) return;
    animate(
      chars,
      { opacity: [0, 1], y: ['0.4em', 0] },
      { duration: IN_MS / 1000, ease: EASE_IN, delay: stagger(each) }
    );
  }

  /** "제 N 문제" 같은 제목이 글자 단위로 올라온다. */
  function titleIn(el) {
    splitIn(el, 0.04);
  }

  /* ================= 화면 안 요소 등장 =================
   * 전체 화면을 scale로 키우면 그 동안 자식(캔버스/사진) 크기를 재는 코드가
   * 애니메이션 중간값을 읽어서 어긋난다. 그래서 이동/투명도만 쓴다.
   *
   * 그리고 지나침(overshoot)이 없어야 한다. 스프링은 목표를 지나쳤다 되돌아오며
   * 멎는데, 그 동안 버튼은 "눈에 보이는 자리"와 "실제로 눌리는 자리"가 다르다.
   * 전자칠판을 급하게 두 번 누르면 엉뚱한 게 눌린다(브라우저 테스트에서 실제로 났다). */
  const ENTER_SELECTOR = [
    '.eyebrow',
    '.headline',
    '.rule',
    '.cells',
    '.gauge-wide',
    '.grading-step',
    '.prize',
    '.prize-note',
    '.display:not([data-solo])',
    '.show-logo:not([data-solo])',
    // .pick-card가 아니라 .pick-face를 움직인다. 겉껍데기는 버튼이라
    // 거기에 transform을 걸면 누르는 자리가 흔들린다.
    '.pick-face',
    '.idle-main > *:not([data-solo])',
    '.idle-side',
    '.center-block > *:not([data-solo])',
    '.stage-foot > *',
    '.ready-head:not([data-solo])',
    '.result-body > *',
  ].join(', ');

  function stageIn(el) {
    if (!el || !enabled) return;

    // data-solo가 붙은 건 제 몫의 등장 연출(titleIn, badgeSlam 등)이 따로 있다.
    // 여기서 같이 움직이면 두 애니메이션이 같은 transform을 두고 싸운다.
    const items = Array.from(el.querySelectorAll(ENTER_SELECTOR));

    animate(el, { opacity: [0, 1] }, { duration: 0.18, ease: 'outQuad' });
    if (!items.length) return;

    animate(
      items,
      { opacity: [0, 1], y: [() => 14 + jitter(4), 0] },
      { duration: IN_MS / 1000, ease: EASE_IN, delay: stagger(STEP_MS / 1000) }
    );
  }

  /** 여러 요소를 차례로 등장시킨다. */
  function listIn(elements, each = STEP_MS) {
    if (!enabled || !elements || !elements.length) return;
    animate(
      elements,
      { opacity: [0, 1], y: [14, 0] },
      { duration: IN_MS / 1000, ease: EASE_IN, delay: stagger(each / 1000) }
    );
  }

  /** 버튼을 누를 때 눌리는 느낌. 터치 화면에서 반응이 있는지 확인시켜 준다.
   *  평면이라 크기를 바꾸지 않는다 — 2px 내려앉는 것으로 충분하다. */
  function pressable(elements) {
    if (!enabled) return;
    const list = elements instanceof Element ? [elements] : Array.from(elements);
    list.forEach((el) => {
      el.addEventListener('pointerdown', () => {
        animate(el, { y: 2, opacity: 0.86 }, { duration: 0.07, ease: 'outQuad' });
      });
      const back = () => animate(el, { y: 0, opacity: 1 }, { duration: 0.14, ease: EASE_IN });
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
    layer.className = 'fx fx-' + name;
    layer.setAttribute('style', layerStyle + extra);
    document.body.appendChild(layer);
    return layer;
  }

  /** 화면 전체가 한 번 번쩍인다. 정답/오답처럼 결과가 갈리는 순간에. */
  function flash(color, duration = 0.4) {
    if (!enabled) return;
    const layer = makeLayer(';background:' + color + ';opacity:0', 'flash');
    animate(layer, { opacity: [0, 0.5, 0] }, { duration, ease: 'outQuad' });
    setTimeout(() => layer.remove(), duration * 1000 + 100);
  }

  /** 화면 전체가 한 번 흔들린다. 정말 "쿵" 해야 하는 순간에만. */
  function shakeScreen(strength = 16) {
    if (!enabled) return;
    animate(
      document.body,
      { x: [0, -strength, strength * 0.7, -strength * 0.4, 0] },
      { duration: 0.36, ease: 'outQuart' }
    );
  }

  /** 요소 하나가 좌우로 떨린다(오답). */
  function shake(el) {
    if (!el || !enabled) return;
    animate(el, { x: [0, -18, 13, -7, 3, 0] }, { duration: 0.45, ease: 'outQuart' });
  }

  /** 초가 줄어들 때 시계가 한 번 깜빡인다. 평면이라 크기가 아니라 밝기로. */
  function timerBeat(el, strong = false) {
    if (!el || !enabled) return;
    animate(
      el,
      { opacity: [1, strong ? 0.35 : 0.6, 1] },
      { duration: strong ? 0.4 : 0.28, ease: 'outQuart' }
    );
  }

  /**
   * 화면 한가운데에 큰 글자를 한 번 띄웠다 지운다("시간 종료" 같은 것).
   * 학생이 쓴 글씨를 계속 덮고 있으면 안 되므로 반드시 사라진다.
   * 시안대로 색 판 위에 글자만 — 테두리도 둥글기도 그림자도 없다.
   */
  function titleCard(text, color = '#ec3013', ms = 1400) {
    if (!enabled) return;
    const layer = makeLayer(';z-index:66', 'titlecard');

    const band = document.createElement('div');
    band.setAttribute(
      'style',
      'width:100%;background:' + color + ';color:#f3f2f2;opacity:0;' +
        'font-weight:800;font-size:13vmin;line-height:0.9;' +
        'letter-spacing:-0.04em;padding:6vmin 4vw;text-align:center'
    );
    band.textContent = text;
    layer.appendChild(band);

    // 위아래에서 띠가 열리듯 펼쳐진다(평면에서 무게를 내는 방법).
    animate(band, { opacity: [0, 1], scaleY: [0.2, 1] }, { duration: 0.3, ease: 'outExpo' });
    animate(
      band,
      { opacity: [1, 0], scaleY: [1, 0.2] },
      { duration: 0.26, delay: ms / 1000 - 0.26, ease: EASE_OUT }
    );

    // 콜백에 기대지 않는다. 남으면 학생이 쓴 걸 가린 채로 행사가 이어진다.
    setTimeout(() => layer.remove(), ms + 250);
  }

  /** 마지막 10초. 화면 가장자리에 빨간 테가 맥동한다(뒤에서도 보이게). */
  let urgentLayer = null;

  function urgentOn() {
    if (!enabled || urgentLayer) return;
    urgentLayer = makeLayer(';z-index:20;border:1.4vmin solid var(--accent);opacity:0', 'urgent');
    animate(
      urgentLayer,
      { opacity: [0.2, 1] },
      { duration: 0.5, loop: true, alternate: true, ease: 'inOutSine' }
    );
  }

  function urgentOff() {
    if (urgentLayer) {
      urgentLayer.remove();
      urgentLayer = null;
    }
  }

  /* ================= 딱 붙는 등장 =================
   * 시안에는 튀어나오는 게 없다. 그래서 "쿵"은 크기가 아니라 한 번에 멎는
   * 속도와 색 번쩍임으로 낸다. */
  function slam(el) {
    if (!el || !enabled) return;
    animate(el, { opacity: [0, 1], y: [-26, 0] }, { duration: 0.26, ease: 'outExpo' });
  }

  /** 난이도 배지가 옆에서 밀려 들어와 멎는다. */
  function badgeSlam(el) {
    if (!el || !enabled) return;
    animate(el, { opacity: [0, 1], x: [-40, 0] }, { duration: 0.3, ease: 'outExpo' });
  }

  /** 타이머가 자리를 잡는다. */
  function timerIn(el) {
    if (!el || !enabled) return;
    animate(el, { opacity: [0, 1], y: [-14, 0] }, { duration: 0.3, ease: EASE_IN });
  }

  /** 문제 사진이 조용히 떠오른다. 판 크기는 절대 안 건드린다. */
  function photoIn(el) {
    if (!el || !enabled) return;
    animate(el, { opacity: [0, 1] }, { duration: 0.35, ease: 'outQuad' });
  }

  /* ================= 게이지 =================
   * 시안에서 유일하게 움직이는 것. 남은 시간과 채점 진행을 같은 문법으로 보여준다. */

  /** 남은 시간 막대. ratio 0~1. */
  function gauge(el, ratio, urgent) {
    if (!el) return;
    el.style.width = Math.max(0, Math.min(1, ratio)) * 100 + '%';
    el.style.background = urgent ? 'var(--accent)' : 'var(--text)';
  }

  /**
   * 채점 막대가 차오른다. 정답을 바로 까지 않고 여기서 뜸을 들인다.
   * 단계 이름이 바뀔 때마다 onStep으로 알려준다.
   */
  function gradeBar(el, ms = 1400, onStep) {
    const steps = ['답안 확인', '정답 대조', '결과 산출'];
    let at = -1;
    const advance = (i) => {
      if (i === at) return;
      at = i;
      sounds.grade();
      if (onStep) onStep(steps[i]);
    };
    advance(0);

    if (!enabled) {
      if (el) el.style.width = '100%';
      return new Promise((resolve) => setTimeout(resolve, 240));
    }

    if (el) {
      el.style.width = '0%';
      el.style.background = 'var(--text)';
      animate(el, { width: ['0%', '100%'] }, { duration: ms / 1000, ease: 'inOutQuad' });
    }

    const t1 = setTimeout(() => advance(1), ms * 0.4);
    const t2 = setTimeout(() => advance(2), ms * 0.8);

    return new Promise((resolve) =>
      setTimeout(() => {
        clearTimeout(t1);
        clearTimeout(t2);
        resolve();
      }, ms)
    );
  }

  /* ================= 화면 전환 =================
   * 판이 옆으로 교대한다. 나가는 판은 왼쪽으로 빠지고 들어오는 판은 오른쪽에서 들어온다.
   *
   * 필기 화면(.stage-play)만은 절대 안 움직인다. 캔버스 좌표가 걸려 있어서
   * 어떤 이유로든 transform이 남으면 학생이 쓴 글씨와 펜 끝이 통째로 어긋난다. */

  const SWAP_OUT_MS = 220;
  const SWAP_IN_MS = 340;

  function isFlatStage(el) {
    return !!el && el.classList.contains('stage-play');
  }

  /** 화면을 정리해 원래 상태로 돌려놓는다. 남은 transform은 그 자체로 사고다. */
  function clearStage(el) {
    if (!el) return;
    el.style.transform = '';
    el.style.opacity = '';
  }

  function transition(outEl, inEl) {
    if (!enabled) {
      if (outEl && outEl !== inEl) outEl.hidden = true;
      return;
    }
    sounds.whoosh();

    if (outEl && outEl !== inEl) {
      animate(
        outEl,
        isFlatStage(outEl) ? { opacity: [1, 0] } : { opacity: [1, 0], x: [0, '-3%'] },
        {
          duration: SWAP_OUT_MS / 1000,
          ease: EASE_OUT,
          onComplete: () => {
            outEl.hidden = true;
            clearStage(outEl);
          },
        }
      );
      // 콜백에 기대지 않는다. 안 불리면 두 화면이 겹친 채로 남는다.
      setTimeout(() => {
        if (outEl.hidden) return;
        outEl.hidden = true;
        clearStage(outEl);
      }, SWAP_OUT_MS + 160);
    }

    if (inEl && !isFlatStage(inEl)) {
      animate(
        inEl,
        { opacity: [0, 1], x: ['3%', '0%'] },
        { duration: SWAP_IN_MS / 1000, ease: EASE_IN, onComplete: () => clearStage(inEl) }
      );
      setTimeout(() => clearStage(inEl), SWAP_IN_MS + 160);
    }
  }

  /* ================= 카운트다운 ================= */

  /**
   * 3 → 2 → 1 → 시작 을 화면 가득 띄우고 끝나면 resolve.
   * 시안 그대로: 바탕색 판 위에 숫자 하나. 장식 없음.
   */
  function countdown(from = 3) {
    sounds.start();
    if (!enabled) return Promise.resolve();

    return new Promise((resolve) => {
      const layer = makeLayer(';z-index:70;background:var(--bg)', 'countdown');

      // 어떤 이유로든 레이어가 남으면 화면을 덮어 진행이 막힌다.
      // 정리는 타이머로 보장하고, 두 번 불려도 안전하게 만든다.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        layer.remove();
        resolve();
      };

      const STEP = 700;

      const showNumber = (text, accent) => {
        const num = document.createElement('div');
        num.setAttribute(
          'style',
          'position:absolute;font-weight:800;font-size:38vmin;line-height:1;' +
            'letter-spacing:-0.05em;opacity:0;color:' +
            (accent ? 'var(--accent)' : 'var(--text)')
        );
        num.textContent = text;
        layer.appendChild(num);

        sounds.countdown();
        // 딱 나타났다가 딱 사라진다. 커지거나 돌지 않는다.
        animate(num, { opacity: [0, 1], y: [18, 0] }, { duration: 0.18, ease: 'outExpo' });
        animate(
          num,
          { opacity: [1, 0] },
          { duration: 0.16, delay: STEP / 1000 - 0.16, ease: EASE_OUT }
        );
        setTimeout(() => num.remove(), STEP + 60);
      };

      const words = [];
      for (let n = from; n >= 1; n -= 1) words.push([String(n), false]);
      words.push(['시작', true]);

      words.forEach(([text, accent], i) => {
        setTimeout(() => showNumber(text, accent), i * STEP);
      });

      setTimeout(finish, words.length * STEP);
      // 안전장치: 위 타이머가 어떤 이유로든 안 돌면 화면이 영영 덮인다.
      setTimeout(finish, words.length * STEP + 1200);
    });
  }

  /* ================= 결과 ================= */

  /** 정답 — 빨간빛이 화면을 한 번 친다. */
  function celebrate() {
    sounds.fanfare();
    flash('var(--accent)', 0.42);
    shakeScreen(14);
  }

  /** 오답 — 화면을 짧게 흔든다. */
  function reject() {
    shakeScreen(18);
  }

  /** 판정 띠(정답/오답/시간 종료)가 위아래로 펼쳐진다. */
  function verdictIn(el) {
    if (!el || !enabled) return;
    animate(el, { scaleY: [0.15, 1], opacity: [0, 1] }, { duration: 0.3, ease: 'outExpo' });
  }

  return {
    enabled,
    // 등장 연출이 끝나기 전에 누르면 엉뚱한 게 눌린다. 그 동안 입력을 잠근다.
    // 지나침(overshoot)이 없어져서 예전(1260ms)보다 훨씬 짧다.
    settleMs: Math.max(SWAP_IN_MS, IN_MS + STEP_MS * 4) + 80,

    sounds,
    toggleMute,
    unlockAudio,

    stageIn,
    listIn,
    pressable,
    splitIn,
    unsplit,
    titleIn,

    timerBeat,
    timerIn,
    urgentOn,
    urgentOff,
    gauge,
    gradeBar,

    slam,
    badgeSlam,
    photoIn,
    shake,
    shakeScreen,
    flash,
    titleCard,
    countdown,

    transition,
    clearStage,

    celebrate,
    reject,
    verdictIn,
  };
})();
