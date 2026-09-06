/* 진행 화면 연출.
 *
 * 강당 앞 65~86인치 화면이고 뒤에는 학생들이 앉아 있다. 얌전한 페이드는
 * 뒤에서 보이지도 않고 아무 반응도 못 끌어낸다. 그래서 크게 움직인다.
 *
 * 다만 "크게"가 "뚝뚝 끊기게"는 아니다. 움직임은 전부 무게가 있는 것처럼
 * 굴러야 한다. 그래서 대부분을 스프링(물리 기반)으로 안착시키고, 등장에는
 * 원근(3D)을 써서 깊이에서 다가오게 만든다. 화면을 흔드는 건 정말 "쿵" 해야
 * 하는 순간에만 남겼다.
 *
 * 라이브러리가 없거나 사용자가 "동작 줄이기"를 켰으면 연출 없이 결과 상태만
 * 남는다(연출이 빠져도 행사 진행은 계속돼야 한다).
 */
window.SMFShowAnim = (function () {
  const hasAnime = typeof window.anime !== 'undefined';
  const prefersReduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const enabled = hasAnime && !prefersReduced;

  const animate = hasAnime ? window.anime.animate : null;
  const stagger = hasAnime ? window.anime.stagger : null;
  const createSpring = hasAnime ? window.anime.createSpring : null;

  /* ================= 움직임의 기본 성질 =================
   * 스프링은 "얼마나 세게 당기고(stiffness) 얼마나 빨리 잦아드는지(damping),
   * 얼마나 무거운지(mass)"로 정해진다. 값을 이름으로 묶어두고 재사용해서
   * 화면마다 움직임의 성격이 따로 놀지 않게 한다. */
  const SPRING = createSpring
    ? {
        // 가볍게 떠오르는 것들(글자, 목록)
        soft: createSpring({ stiffness: 92, damping: 15, mass: 1 }),
        // 버튼처럼 또렷하게 자리잡아야 하는 것
        firm: createSpring({ stiffness: 150, damping: 19, mass: 1 }),
        // 큰 덩어리. 살짝 늦게 멎으면서 무게가 느껴진다.
        heavy: createSpring({ stiffness: 118, damping: 17, mass: 1.7 }),
        // 눌렀다 놓을 때 통통 튀는 느낌
        press: createSpring({ stiffness: 320, damping: 20, mass: 0.8 }),
      }
    : {};

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

  /* ================= 배경 먼지 =================
   * 화면이 완전히 멈춰 있으면 죽은 화면처럼 보인다. 점심시간 내내 켜두니 더 그렇다.
   * 알갱이마다 다른 깊이(z)에 놓는다. 원근이 걸려 있어서 멀리 있는 건 저절로
   * 작고 흐리게 보이고, 카메라가 움직이면 앞뒤가 다른 속도로 흐른다(시차). */
  function ambient(host, count = 34) {
    if (!host) return;
    host.textContent = '';
    if (!enabled) return;

    for (let i = 0; i < count; i += 1) {
      const mote = document.createElement('span');
      mote.className = 'mote';
      // z가 뒤로 갈수록 멀다. 멀면 작고, 어둡고, 느리게 흐른다.
      const z = -(Math.random() * 620);
      const far = -z / 620; // 0(가까움) ~ 1(멂)
      mote.style.setProperty('--z', `${z.toFixed(0)}px`);
      mote.style.setProperty('--size', `${(1.5 + (1 - far) * 4).toFixed(1)}px`);
      mote.style.setProperty('--soft', `${(0.2 + far * 1.6).toFixed(2)}px`);
      mote.style.setProperty('--x', `${(Math.random() * 100).toFixed(1)}%`);
      mote.style.setProperty('--drift', `${jitter(7).toFixed(1)}vw`);
      mote.style.setProperty('--dur', `${(20 + far * 34 + Math.random() * 8).toFixed(1)}s`);
      // 처음부터 화면 곳곳에 흩어져 있어야 한다. 다 같이 바닥에서 출발하면
      // 첫 20초 동안 화면이 비어 보인다.
      mote.style.setProperty('--delay', `${(-Math.random() * 45).toFixed(1)}s`);
      mote.style.setProperty('--peak', (0.1 + (1 - far) * 0.45).toFixed(2));
      host.appendChild(mote);
    }
  }

  /* ================= 두께 만들기(압출) =================
   * 같은 글자를 z만 뒤로 밀어 여러 장 겹치면 실제 두께가 생긴다. 뒤로 갈수록
   * 어두워야 깎인 면처럼 보인다. 이 상태에서 돌리면 옆면이 드러나면서
   * 평면 글자가 아니라 깎아 만든 물체로 읽힌다.
   *
   * 주의: 겹친 층도 글자라서, 이걸 씌운 요소의 textContent에는 같은 글자가
   * 여러 번 들어간다. 값을 읽어 가는 요소(정답 등)에는 쓰지 않는다. */
  function makeExtruded(text, { layers = 14, step = 3, front = '#ffffff' } = {}) {
    const box = document.createElement('span');
    box.className = 'extrude';

    for (let i = layers; i >= 1; i -= 1) {
      const layer = document.createElement('span');
      layer.className = 'extrude-layer';
      layer.setAttribute('aria-hidden', 'true');
      // 뒤로 갈수록 어둡게. 맨 뒤가 거의 검게 잠겨야 두께가 두께로 보인다.
      const shade = Math.round(150 * (1 - i / layers));
      layer.style.transform = `translateZ(${-i * step}px)`;
      layer.style.color = `rgb(${shade},${shade},${shade + 2})`;
      layer.textContent = text;
      box.appendChild(layer);
    }

    const face = document.createElement('span');
    face.style.position = 'relative';
    face.style.color = front;
    face.textContent = text;
    box.appendChild(face);

    return box;
  }

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
   * 글자가 아래에서 하나씩 일어선다.
   * 요소 하나든 여러 줄이든 받는다. 줄을 따로 넘겨야 하는 이유는,
   * 한 요소의 textContent를 통째로 쪼개면 줄바꿈이 사라지기 때문이다.
   */
  function splitIn(target, each = 0.035) {
    if (!target || !enabled) return;
    const els = target instanceof Element ? [target] : Array.from(target);
    const chars = [];
    els.forEach((el) => chars.push(...splitChars(el)));
    if (!chars.length) return;
    animate(
      chars,
      { opacity: [0, 1], y: ['0.55em', 0], rotateX: [-72, 0] },
      { ease: SPRING.soft, delay: stagger(each) }
    );
  }

  /* ================= 카메라 =================
   * 무대의 소실점(perspective-origin)을 옮기면, 물건은 가만히 있는데
   * 보는 자리가 옮겨간 것처럼 보인다. 화면이 바뀔 때마다 살짝 흘려주면
   * 같은 배치라도 매번 다르게 읽힌다.
   *
   * 소실점을 통째로 애니메이션하는 대신 CSS 변수 두 개를 움직인다.
   * 값이 숫자라 중간값이 제대로 만들어진다. */
  function cameraMove(el) {
    if (!el || !enabled) return;
    const fromX = 50 + jitter(9);
    const fromY = 45 + jitter(7);
    animate(
      el,
      { '--cam-x': [`${fromX.toFixed(1)}%`, '50%'], '--cam-y': [`${fromY.toFixed(1)}%`, '45%'] },
      { duration: 1.4, ease: 'outQuint' }
    );
  }

  /* ================= 화면 전환 =================
   * 전체 화면을 scale로 키우면 그 동안 자식(캔버스/사진) 크기를 재는 코드가
   * 애니메이션 중간값을 읽어서 어긋난다. 그래서 이동/회전/투명도만 쓴다. */
  /**
   * 누를 수 있는 것과 그냥 보는 것은 등장 방식을 달리한다.
   *
   * 스프링은 목표를 지나쳤다 되돌아오며 멎는다. 보기에는 좋지만, 그 동안
   * 버튼은 "눈에 보이는 자리"와 "실제로 눌리는 자리"가 다르다. 전자칠판을
   * 급하게 두 번 누르면 엉뚱한 게 눌린다(브라우저 테스트에서 실제로 났다).
   * 그래서 버튼과 카드는 지나침 없이 빠르게 앉히고, 장식만 스프링으로 둔다.
   */
  const TAPPABLE = '.btn, .pick-face, .choose-row';
  const SETTLE_MS = 500;

  function stageIn(el) {
    if (!el || !enabled) return;

    // data-solo가 붙은 건 제 몫의 등장 연출(titleIn, badgeSlam 등)이 따로 있다.
    // 여기서 같이 움직이면 두 애니메이션이 같은 transform을 두고 싸운다.
    // .pick-card가 아니라 .pick-face를 움직인다. 겉껍데기는 원호 위 각도를
    // 붙들고 있어서, 거기에 transform을 걸면 그 각도가 지워진다.
    const all = Array.from(
      el.querySelectorAll(
        '.show-logo:not([data-solo]), .show-tagline, .idle-actions > *, .idle-emblem, ' +
          '.stage-title, .pick-face, .center-block > *:not([data-solo]), .choose-row'
      )
    );
    const tappable = all.filter((node) => node.matches(TAPPABLE));
    const decor = all.filter((node) => !node.matches(TAPPABLE));

    animate(el, { opacity: [0, 1] }, { duration: 0.22, ease: 'outQuad' });
    cameraMove(el);

    // 장식: 깊이에서 느긋하게 다가와 스프링으로 안착
    if (decor.length) {
      animate(
        decor,
        {
          opacity: [0, 1],
          y: [() => 46 + jitter(10), 0],
          z: [() => -260 + jitter(60), 0],
          rotateX: [() => -14 + jitter(4), 0],
        },
        { ease: SPRING.soft, delay: stagger(0.06, { start: 0.04 }) }
      );
    }

    // 누르는 것: 더 멀리서 오되 한 번에 멎는다(지나쳤다 돌아오지 않는다)
    if (tappable.length) {
      animate(
        tappable,
        {
          opacity: [0, 1],
          y: [() => 58 + jitter(8), 0],
          z: [() => -300 + jitter(40), 0],
          rotateX: [-16, 0],
        },
        {
          duration: SETTLE_MS / 1000,
          ease: 'outQuint',
          delay: stagger(0.05, { start: 0.03 }),
        }
      );
    }
  }

  /** 여러 요소를 차례로 등장시킨다. */
  function listIn(elements, each = 45) {
    if (!enabled || !elements.length) return;
    animate(
      elements,
      { opacity: [0, 1], y: [26, 0], z: [-120, 0] },
      { ease: SPRING.soft, delay: stagger(each / 1000) }
    );
  }

  /** 버튼을 누를 때 눌리는 느낌. 터치 화면에서 반응이 있는지 확인시켜 준다. */
  function pressable(elements) {
    if (!enabled) return;
    const list = elements instanceof Element ? [elements] : Array.from(elements);
    list.forEach((el) => {
      el.addEventListener('pointerdown', () => {
        // 평면에서 줄어들기만 하면 눌린 게 아니라 작아진 것처럼 보인다.
        // 살짝 뒤로 눕히면 진짜 눌린 것처럼 읽힌다.
        animate(el, { scale: 0.955, rotateX: 7, z: -26 }, { duration: 0.1, ease: 'outQuad' });
      });
      const back = () =>
        animate(el, { scale: 1, rotateX: 0, z: 0 }, { ease: SPRING.press });
      el.addEventListener('pointerup', back);
      el.addEventListener('pointerleave', back);
      el.addEventListener('pointercancel', back);
    });
  }

  /* ================= 공용 연출 조각 ================= */

  const layerStyle =
    'position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;' +
    'pointer-events:none;font-family:inherit';

  /**
   * 연출용 겹치는 판을 만든다.
   * behind=true면 무대(.stage)보다 뒤에 깐다. 무대 배경이 투명해서
   * body의 첫 자식으로 넣으면 내용 뒤에서 비친다(햇살 등).
   */
  function makeLayer(extra = '', name = 'fx', behind = false) {
    const layer = document.createElement('div');
    layer.className = `fx fx-${name}`;
    layer.setAttribute('style', layerStyle + extra);
    if (behind) document.body.insertBefore(layer, document.body.firstChild);
    else document.body.appendChild(layer);
    return layer;
  }

  /** 화면 전체가 한 번 번쩍인다. 정답/오답처럼 결과가 갈리는 순간에. */
  function flash(color, duration = 0.5) {
    if (!enabled) return;
    const layer = makeLayer(`;background:${color};opacity:0`, 'flash');
    // 어두운 바탕이라 예전만큼 세게 때리면 눈이 아프다. 살짝 낮췄다.
    animate(layer, { opacity: [0, 0.55, 0] }, { duration, ease: 'outQuad' });
    setTimeout(() => layer.remove(), duration * 1000 + 100);
  }

  /** 가운데에서 빛 무리가 퍼져나간다. */
  function ring(color, count = 3) {
    if (!enabled) return;
    const layer = makeLayer(';overflow:hidden', 'ring');
    const rings = [];

    for (let i = 0; i < count; i += 1) {
      const r = document.createElement('div');
      r.setAttribute(
        'style',
        `position:absolute;width:20vmin;height:20vmin;border-radius:50%;` +
          `border:0.8vmin solid ${color};opacity:0;` +
          `box-shadow:0 0 4vmin ${color}, inset 0 0 4vmin ${color}`
      );
      layer.appendChild(r);
      rings.push(r);
    }

    // 처음엔 빠르게 퍼지다 끝에서 느려진다. 실제로 퍼져나가는 파동처럼.
    animate(
      rings,
      { scale: [0.2, 6.5], opacity: [0.85, 0] },
      { duration: 1.3, delay: stagger(0.13), ease: 'outExpo' }
    );
    setTimeout(() => layer.remove(), 1800);
  }

  /** 빛이 확 부풀었다 사그라든다. 뭔가가 "켜지는" 순간에. */
  function bloom(color = 'rgba(255,255,255,.5)', ms = 900) {
    if (!enabled) return;
    const layer = makeLayer(';overflow:hidden', 'bloom');
    const orb = document.createElement('div');
    orb.setAttribute(
      'style',
      `position:absolute;width:60vmin;height:60vmin;border-radius:50%;opacity:0;` +
        `background:radial-gradient(circle, ${color}, transparent 66%)`
    );
    layer.appendChild(orb);
    animate(
      orb,
      { scale: [0.3, 1.9], opacity: [0, 0.9, 0] },
      { duration: ms / 1000, ease: 'outQuint' }
    );
    setTimeout(() => layer.remove(), ms + 200);
  }

  /** 화면을 통째로 흔든다. 정말 "쿵" 해야 하는 순간에만. */
  function shakeScreen(strength = 20) {
    if (!enabled) return;
    // 한 방향으로 세게 밀렸다가 잦아든다. 좌우로 규칙적으로 흔들면
    // 진동하는 물건처럼 보이지 충격처럼 안 보인다.
    animate(
      document.body,
      { x: [0, -strength, strength * 0.55, -strength * 0.26, strength * 0.1, 0] },
      { duration: 0.6, ease: 'outQuart' }
    );
  }

  /* ================= 타이머 ================= */

  /**
   * 남은 시간이 얼마 안 남았을 때 타이머가 크게 뛴다.
   * 글자 크기(font-size)를 건드리면 진행 바 높이가 바뀌고, 그러면 판 크기가
   * 바뀌면서 이미 쓴 글씨와 캔버스가 어긋난다. 그래서 transform만 쓴다.
   */
  function timerBeat(el, strong = false) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [1, strong ? 1.5 : 1.32, 1] },
      { duration: strong ? 0.52 : 0.44, ease: 'outQuart' }
    );
  }

  /**
   * 화면 한가운데에 큰 글자를 한 번 띄웠다 지운다("시간 종료!" 같은 것).
   * 학생이 쓴 글씨를 계속 덮고 있으면 안 되므로 반드시 사라진다.
   */
  function titleCard(text, color = '#f4f4f2', ms = 1500) {
    if (!enabled) return;
    const layer = makeLayer(';z-index:66', 'titlecard');

    const word = document.createElement('div');
    word.setAttribute(
      'style',
      `font-family:var(--serif);font-size:16vmin;font-weight:700;line-height:1;color:${color};` +
        `opacity:0;padding:3vmin 8vmin;border-radius:4vmin;` +
        `background:linear-gradient(168deg, rgba(255,255,255,.13), rgba(255,255,255,.04));` +
        `backdrop-filter:blur(2.6vmin) saturate(150%);` +
        `-webkit-backdrop-filter:blur(2.6vmin) saturate(150%);` +
        `border:0.3vmin solid ${color};` +
        `box-shadow:0 3vmin 7vmin rgba(2,14,18,.6), 0 0 12vmin ${color}`
    );
    word.textContent = text;
    layer.appendChild(word);

    animate(word, { scale: [1.7, 1], opacity: [0, 1], z: [280, 0] }, { ease: SPRING.heavy });
    animate(
      word,
      { opacity: [1, 0], scale: [1, 1.08], filter: ['blur(0px)', 'blur(1.2vmin)'] },
      { duration: 0.45, delay: ms / 1000 - 0.45, ease: 'inQuad' }
    );

    // 콜백에 기대지 않는다. 남으면 학생이 쓴 걸 가린 채로 행사가 이어진다.
    setTimeout(() => layer.remove(), ms + 250);
  }

  /** 마지막 10초 동안 화면 가장자리가 붉게 맥동한다(뒤에서도 보이게). */
  let urgentLayer = null;

  function urgentOn() {
    if (!enabled || urgentLayer) return;
    urgentLayer = makeLayer(
      ';z-index:20;box-shadow:inset 0 0 14vmin 3vmin rgba(255,95,86,.5);opacity:0',
      'urgent'
    );
    animate(
      urgentLayer,
      { opacity: [0.15, 0.95] },
      { duration: 0.55, loop: true, alternate: true, ease: 'inOutSine' }
    );
  }

  function urgentOff() {
    if (urgentLayer) {
      urgentLayer.remove();
      urgentLayer = null;
    }
  }

  /* ================= 정답 공개 ================= */

  /**
   * 정답판이 옆으로 선 채(거의 날처럼 얇게 보이는 상태) 날아와 돌아선다.
   * 그냥 커지면서 나타나면 그림이 바뀐 것이고, 돌아서면 물건이 움직인 것이다.
   */
  function slam(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { rotateY: [-96, 0], z: [420, 0], opacity: [0, 1], scale: [1.18, 1] },
      { ease: SPRING.heavy }
    );
    bloom('rgba(255,255,255,.45)', 800);
    setTimeout(() => {
      shakeScreen(14);
      ring('rgba(255,255,255,.8)', 2);
    }, 240);
  }

  function shake(el) {
    if (!el || !enabled) return;
    animate(el, { x: [0, -20, 15, -9, 4, 0] }, { duration: 0.55, ease: 'outQuart' });
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
   * 점 세 개가 차례로 부풀고, 글자에 걸린 빛이 같이 밝아졌다 어두워진다.
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
      { scale: [0.55, 1.5], opacity: [0.35, 1] },
      { duration: 0.4, delay: stagger(0.13), loop: true, alternate: true, ease: 'inOutSine' }
    );

    // 예전에는 무대를 잘게 흔들었는데, 흔들림은 "충격"의 신호라 기다리는
    // 순간에 쓰면 어색하다. 대신 빛이 차오른다.
    if (labelEl) {
      animate(
        labelEl,
        { opacity: [0.55, 1] },
        { duration: 0.55, loop: true, alternate: true, ease: 'inOutSine' }
      );
    }

    return new Promise((resolve) =>
      setTimeout(() => {
        dots.remove();
        if (labelEl) animate(labelEl, { opacity: 1 }, { duration: 0.2 });
        resolve();
      }, ms)
    );
  }

  /**
   * 난이도 배지가 동전처럼 뒤집히며 들어온다.
   * 뒷면을 보인 채 날아와 한 바퀴 반을 돌아 앞면으로 멎는다.
   * 앞/뒤 면이 실제로 따로 있어서(backface-visibility) 돌 때 두께가 읽힌다.
   */
  function badgeSlam(el) {
    if (!el || !enabled) return;
    const body = el.querySelector('.coin-body') || el;

    animate(el, { z: [-420, 0], opacity: [0, 1], scale: [0.72, 1] }, { ease: SPRING.heavy });
    animate(body, { rotateY: [-540, 0], rotateX: [16, 0] }, { ease: SPRING.heavy });
    setTimeout(() => bloom('rgba(255,255,255,.32)', 700), 300);
  }

  /** 타이머가 위에서 떨어지며 자리를 잡는다. */
  function timerIn(el) {
    if (!el || !enabled) return;
    animate(el, { scale: [1.9, 1], y: [-34, 0], opacity: [0, 1] }, { ease: SPRING.firm });
  }

  /** "제 N 문제" 같은 제목이 글자 단위로 일어선다. */
  function titleIn(el) {
    if (!el || !enabled) return;
    splitIn(el, 0.045);
  }

  /* ================= 화면 전환 와이프 =================
   * 무대가 슬그머니 바뀌면 뒤에 앉은 학생은 넘어간 줄도 모른다.
   * 어두운 천이 화면을 한 번 쓸고 지나가고, 앞머리에 금빛 선이 달린다. */

  const WIPE_MS = 640;

  function wipe() {
    if (!enabled) return;
    sounds.whoosh();

    const layer = makeLayer(';overflow:hidden;z-index:65', 'wipe');

    // left를 안 잡으면 flex 가운데 정렬이 시작 위치가 돼서 띠가 화면 중앙에서 튀어나온다
    const makeBar = (background, width) => {
      const bar = document.createElement('div');
      bar.setAttribute(
        'style',
        `position:absolute;left:0;top:-20%;height:140%;width:${width};background:${background}`
      );
      layer.appendChild(bar);
      return bar;
    };

    // 어두운 천 + 그 앞머리를 달리는 가느다란 금빛
    const sheet = makeBar(
      'linear-gradient(100deg, rgba(8,8,10,0) 0%, rgba(8,8,10,.97) 18%, rgba(24,25,29,.97) 82%, rgba(8,8,10,0) 100%)',
      '92vw'
    );
    const edge = makeBar(
      'linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.9), rgba(255,255,255,0))',
      '9vw'
    );

    // skewX는 [값, 값]으로 줘야 기운 채로 고정된다.
    // anime가 transform을 통째로 다시 쓰기 때문에 인라인 transform은 남지 않는다.
    // 가속했다 감속하는 이징이라 천이 실제로 당겨지는 것처럼 보인다.
    animate(
      [sheet, edge],
      { x: ['-115vw', '200vw'], skewX: [-11, -11] },
      { duration: WIPE_MS / 1000, delay: stagger(0.05), ease: 'inOutQuint' }
    );

    // 애니메이션 콜백에 기대지 않는다. 이 판이 남으면 화면이 덮인다.
    setTimeout(() => layer.remove(), WIPE_MS + 320);
  }

  /* ================= 대기 화면 =================
   * 점심시간 내내 켜둔 채로 학생들이 들어온다. 완전히 멈춘 화면은
   * 고장 난 것처럼 보인다. 로고가 천천히 숨쉬게 둔다. */
  let breathing = null;

  function breathe(el) {
    stopBreathe();
    if (!el || !enabled) return;
    // 화면 등장 연출(stageIn)이 끝난 뒤에 시작한다. 겹치면 둘이 같은
    // transform을 두고 싸워서 로고가 튄다.
    breathing = animate(
      el,
      { scale: [1, 1.035], rotateX: [1.2, -1.2] },
      { duration: 3.4, delay: 1, loop: true, alternate: true, ease: 'inOutSine' }
    );
  }

  function stopBreathe() {
    if (!breathing) return;
    if (typeof breathing.pause === 'function') breathing.pause();
    breathing = null;
  }

  /* ================= 3, 2, 1 카운트다운 ================= */

  const NUMBER_STYLE =
    'position:absolute;font-family:var(--serif);font-size:46vmin;font-weight:700;' +
    'line-height:1;opacity:0;transform-style:preserve-3d';

  /**
   * 3 → 2 → 1 → 시작! 을 화면 가득 띄우고 끝나면 resolve.
   * 숫자마다 줄어드는 링이 같이 돌아서 "곧 시작한다"가 멀리서도 읽힌다.
   */
  function countdown(from = 3) {
    sounds.start();
    if (!enabled) return Promise.resolve();

    return new Promise((resolve) => {
      const layer = makeLayer(
        ';z-index:70;background:radial-gradient(70vmin 70vmin at 50% 50%, rgba(23,24,28,.97), rgba(8,8,10,.99))',
        'countdown'
      );

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
        // 평면 숫자가 아니라 깎아 만든 숫자. 돌면서 다가오면 옆면이 드러난다.
        const num = document.createElement('div');
        num.setAttribute('style', NUMBER_STYLE);
        num.appendChild(makeExtruded(text, { layers: 18, step: 4 }));
        layer.appendChild(num);

        const circle = document.createElement('div');
        circle.setAttribute(
          'style',
          'position:absolute;width:66vmin;height:66vmin;border-radius:50%;' +
            'border:0.4vmin solid rgba(255,255,255,.7);opacity:0;' +
            'box-shadow:0 0 4vmin rgba(255,255,255,.3)'
        );
        layer.appendChild(circle);

        sounds.countdown();

        // 깊이에서 돌면서 다가와 지나쳐 간다. 좌우로 번갈아 돌려서
        // 세 숫자가 같은 그림의 반복으로 보이지 않게 한다.
        const spin = index % 2 ? 1 : -1;
        animate(
          num,
          {
            z: [-900, 260],
            opacity: [0, 1, 1, 0],
            rotateY: [42 * spin, -10 * spin],
            rotateX: [index % 2 ? 14 : -14, 0],
          },
          { duration: STEP_MS / 1000, ease: 'outQuint' }
        );
        animate(
          circle,
          { scale: [1.7, 0.62], opacity: [0.85, 0] },
          { duration: STEP_MS / 1000, ease: 'outQuad' }
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
          go.setAttribute('style', NUMBER_STYLE + ';font-size:22vmin');
          go.appendChild(makeExtruded('시작!', { layers: 14, step: 4 }));
          layer.appendChild(go);

          boom(0.32);
          animate(
            go,
            { scale: [0.5, 1.06], opacity: [0, 1], rotateX: [-38, 0] },
            { ease: SPRING.firm }
          );
          animate(layer, { opacity: [1, 0] }, { duration: 0.5, delay: 0.34, ease: 'outQuad' });
          setTimeout(finish, 880);
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

  // 무채색 무대라 색종이도 흰색 계열로 간다. 밝기만 달리해도 충분히 흩날려 보인다.
  const CONFETTI_COLORS = ['#ffffff', '#e6e6e3', '#c9c9c6', '#f4f4f2', '#a8a8a5', '#ffffff'];

  /**
   * 가운데에서 색종이가 터져 나온다.
   * 사방으로 똑같이 흩어지면 폭발 그림이지 색종이가 아니다. 터져 오른 뒤
   * 중력에 실려 떨어지도록 두 구간으로 나눠 움직인다.
   */
  function confetti(count = 90) {
    if (!enabled) return;
    const layer = makeLayer(
      ';z-index:50;overflow:hidden;perspective:1000px;transform-style:preserve-3d',
      'confetti'
    );

    const W = window.innerWidth;
    const H = window.innerHeight;
    const pieces = [];

    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement('div');
      const size = 10 + Math.random() * 18;
      piece.className = 'fx-piece';
      piece.setAttribute(
        'style',
        `position:absolute;left:50%;top:52%;width:${size}px;` +
          `height:${size * (0.32 + Math.random() * 0.5)}px;` +
          `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]};border-radius:1px;` +
          `box-shadow:0 0 1.2vmin rgba(255,255,255,.25)`
      );
      layer.appendChild(piece);
      pieces.push(piece);
    }

    const DURATION_MS = 2900;

    animate(
      pieces,
      {
        // 옆으로는 계속 밀려나되 공기 저항으로 점점 느려진다
        x: () => (Math.random() - 0.5) * W * 1.25,
        // 위로 솟았다가 떨어진다. 올라갈 때는 감속, 내려올 때는 가속.
        y: [
          { to: () => -H * (0.18 + Math.random() * 0.34), duration: 700, ease: 'outQuad' },
          { to: () => H * (0.6 + Math.random() * 0.4), duration: 2200, ease: 'inQuad' },
        ],
        // 앞뒤로도 흩어진다. 어떤 건 내 앞을 스쳐 가고 어떤 건 멀리서 떨어진다.
        z: () => (Math.random() - 0.35) * 900,
        rotate: () => (Math.random() - 0.5) * 900,
        // 종잇조각이 뒤집히며 반짝인다
        rotateX: () => Math.random() * 1080,
        rotateY: () => (Math.random() - 0.5) * 900,
        opacity: [{ to: 1, duration: 120 }, { to: 1, duration: 2100 }, { to: 0, duration: 600 }],
      },
      { duration: DURATION_MS / 1000, ease: 'outQuad' }
    );

    // 애니메이션 완료 콜백에 기대지 않고 직접 치운다.
    // 안 치우면 축하할 때마다 레이어가 화면에 쌓인다.
    setTimeout(() => layer.remove(), DURATION_MS + 400);
  }

  /**
   * 뒤에서 퍼지는 햇살. 무대 배경이 투명해서 body 맨 앞에 깔면
   * 트로피와 글자 뒤에서 돌아간다.
   */
  function rays(color, ms = 2800) {
    if (!enabled) return;
    const layer = makeLayer(';overflow:hidden;z-index:0', 'rays', true);

    const sun = document.createElement('div');
    sun.setAttribute(
      'style',
      `position:absolute;width:300vmax;height:300vmax;opacity:0;` +
        `background:repeating-conic-gradient(from 0deg, ${color} 0deg 6deg, transparent 6deg 17deg)`
    );
    layer.appendChild(sun);

    // 확 퍼진 뒤 아주 천천히 계속 돈다. 딱 멈추면 그림 한 장 붙여둔 것처럼 보인다.
    animate(
      sun,
      { scale: [0.15, 1], rotate: [0, 26], opacity: [0, 0.3, 0.26, 0] },
      { duration: ms / 1000, ease: 'outQuint' }
    );
    setTimeout(() => layer.remove(), ms + 250);
  }

  /**
   * 정답 순간 전체 연출.
   * 강당에서 제일 크게 터져야 하는 순간이라 겹칠 수 있는 건 다 겹친다:
   * 초록 번쩍 -> 뒤에서 퍼지는 햇살 -> 빛무리 -> 색종이 두 번.
   */
  function celebrate() {
    if (!enabled) return;
    flash('#4ade80', 0.55);
    bloom('rgba(74,222,128,.5)', 1100);
    rays('rgba(255,255,255,.42)');
    ring('rgba(255,255,255,.85)', 4);
    shakeScreen(13);
    confetti();
    // 한 번 터지고 끝나면 금방 조용해진다. 잦아들 때쯤 한 번 더.
    setTimeout(() => confetti(55), 1000);
  }

  /** 오답 순간: 붉은 번쩍 + 흔들림. */
  function reject() {
    if (!enabled) return;
    flash('#ff5f56', 0.45);
    shakeScreen(24);
  }

  /** 트로피가 떨어져 튀고, 글자가 뒤따라 선다. */
  function trophyIn(markEl, textEl) {
    if (!enabled) return;
    if (markEl) {
      animate(
        markEl,
        { scale: [0.2, 1], rotate: [-140, 0], y: [-220, 0] },
        { ease: SPRING.heavy }
      );
    }
    if (textEl) {
      // 트로피가 자리잡기 시작할 때쯤 뒤따라온다(따라붙는 맛)
      animate(
        textEl,
        { scale: [0.5, 1], opacity: [0, 1], z: [-240, 0] },
        { ease: SPRING.soft, delay: 0.22 }
      );
    }
  }

  /** 문제 사진이 깊이에서 다가오며 등장. */
  function photoIn(el) {
    if (!el || !enabled) return;
    animate(
      el,
      { scale: [0.88, 1], opacity: [0, 1], y: [14, 0] },
      { duration: 0.75, ease: 'outQuint' }
    );
  }

  return {
    enabled,
    /**
     * 등장 연출이 끝나 눌러도 안전해지기까지 걸리는 시간(ms).
     * 마지막 버튼의 시작이 밀리는 만큼(차례 등장) 여유를 더한 값이다.
     * 화면을 잠그는 쪽이 이 값을 보고 맞춘다.
     */
    settleMs: SETTLE_MS + 220,
    sounds,
    boom,
    toggleMute,
    unlockAudio,
    ambient,
    makeExtruded,
    cameraMove,
    stageIn,
    listIn,
    pressable,
    splitIn,
    unsplit,
    timerBeat,
    urgentOn,
    urgentOff,
    slam,
    shake,
    shakeScreen,
    flash,
    ring,
    bloom,
    countdown,
    titleCard,
    wipe,
    titleIn,
    rays,
    breathe,
    stopBreathe,
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
