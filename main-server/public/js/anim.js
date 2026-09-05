// 화면 전반의 모션을 한 곳에서 관리하는 모듈.
// Anime.js(anime)와 Motion(Motion)을 vendor/ 에서 자체 호스팅해서 쓴다(CDN 의존 없음).
//
// 라이브러리가 어떤 이유로든 안 뜨거나 사용자가 "동작 줄이기"를 켜둔 경우에도
// 화면은 그대로 멀쩡히 동작해야 하므로, 모든 함수는 실패 시 "최종 상태를 즉시
// 적용하고 끝내는" 방식으로 안전하게 빠진다.

(function (global) {
  const hasAnime = typeof global.anime !== 'undefined';
  const hasMotion = typeof global.Motion !== 'undefined';
  const prefersReduced =
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const enabled = hasAnime && hasMotion && !prefersReduced;

  const A = hasAnime ? global.anime : null;
  const M = hasMotion ? global.Motion : null;

  function toArray(targets) {
    if (!targets) return [];
    if (typeof targets === 'string') return Array.from(document.querySelectorAll(targets));
    if (targets instanceof Element) return [targets];
    return Array.from(targets);
  }

  function clearTransform(els) {
    toArray(els).forEach((el) => {
      el.style.transform = '';
      el.style.opacity = '';
    });
  }

  const SMFAnim = {
    enabled,

    /** 목록(난이도/단원 버튼 등)이 아래에서 위로 시차를 두고 등장 */
    enterList(targets, options = {}) {
      const els = toArray(targets);
      if (!els.length) return;
      if (!enabled) return clearTransform(els);

      const { delay = 0, y = 26, each = 55 } = options;
      A.set(els, { opacity: 0, translateY: y, scale: 0.97 });
      A.animate(els, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: 620,
        delay: A.stagger(each, { start: delay }),
        ease: 'out(3)',
      });
    },

    /** 화면 상단 고정 HUD들이 위에서 톡 떨어지듯 등장 */
    dropIn(targets, options = {}) {
      const els = toArray(targets);
      if (!els.length) return;
      if (!enabled) return clearTransform(els);

      const { delay = 0, each = 70 } = options;
      A.set(els, { opacity: 0, translateY: -14, scale: 0.94 });
      A.animate(els, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: 700,
        delay: A.stagger(each, { start: delay }),
        ease: A.createSpring({ stiffness: 180, damping: 14 }),
      });
    },

    /** 누르면 쑥 들어갔다가 손 떼면 스프링으로 튀어 올라오는 촉감 */
    pressable(targets, options = {}) {
      const els = toArray(targets);
      if (!enabled || !els.length) return;
      const { scale = 0.93 } = options;

      els.forEach((el) => {
        M.press(el, (element) => {
          M.animate(element, { scale }, { duration: 0.12, ease: 'easeOut' });
          return () => {
            M.animate(element, { scale: 1 }, { type: 'spring', stiffness: 520, damping: 18 });
          };
        });
      });
    },

    /** 마우스를 올리면 살짝 떠오르는 느낌(터치 기기에서는 자동으로 무시됨) */
    hoverLift(targets, options = {}) {
      const els = toArray(targets);
      if (!enabled || !els.length) return;
      const { y = -3 } = options;

      els.forEach((el) => {
        M.hover(el, (element) => {
          M.animate(element, { y }, { duration: 0.22, ease: 'easeOut' });
          return () => M.animate(element, { y: 0 }, { duration: 0.28, ease: 'easeOut' });
        });
      });
    },

    /** 페이지를 떠날 때 살짝 밀려나가며 사라진 뒤 이동(화면 전환이 뚝 끊기지 않게) */
    navigate(url, options = {}) {
      const { container = document.body } = options;
      if (!enabled) {
        global.location.href = url;
        return;
      }
      A.animate(container, {
        opacity: 0,
        translateY: -12,
        duration: 220,
        ease: 'in(2)',
        onComplete: () => {
          global.location.href = url;
        },
      });
      // 애니메이션 콜백이 어떤 이유로든 안 불려서 이동이 막히는 일은 없어야 함
      setTimeout(() => {
        if (global.location.href.indexOf(url) === -1) global.location.href = url;
      }, 450);
    },

    /** 문제 카드가 아래에서 부드럽게 자리잡으며 등장 */
    cardIn(el) {
      if (!el) return;
      if (!enabled) return clearTransform(el);
      A.set(el, { opacity: 0, translateY: 18, scale: 0.985 });
      A.animate(el, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: 720,
        ease: A.createSpring({ stiffness: 140, damping: 16 }),
      });
    },

    /**
     * 타이머 인트로: 화면 한가운데에 크게 튀어나와 흔들리다가 좌상단으로 날아가 자리잡음.
     * from/to는 {left, top, fontSize, padding} 형태의 최종 인라인 스타일 값.
     */
    timerIntro(el, from, to, options = {}) {
      if (!el) return { finished: Promise.resolve() };
      const { holdMs = 900, onLanded } = options;

      const applyTo = () => {
        el.style.left = `${to.left}px`;
        el.style.top = `${to.top}px`;
        el.style.fontSize = `${to.fontSize}px`;
        el.style.padding = to.padding;
        el.style.transform = 'none';
        el.style.opacity = '1';
      };

      if (!enabled) {
        applyTo();
        if (onLanded) onLanded();
        return { finished: Promise.resolve() };
      }

      el.style.left = `${from.left}px`;
      el.style.top = `${from.top}px`;
      el.style.fontSize = `${from.fontSize}px`;
      el.style.padding = from.padding;
      A.set(el, { opacity: 0, scale: 0.3, translateX: '-50%', translateY: '-50%', rotate: 0 });

      const tl = A.createTimeline();

      // 1) 가운데에서 뻥 튀어나옴
      tl.add(el, {
        opacity: 1,
        scale: [0.3, 1],
        duration: 620,
        ease: 'outElastic(1, .55)',
      });

      // 2) 알람시계처럼 좌우로 흔들림
      tl.add(
        el,
        {
          rotate: [
            { to: -9, duration: 90 },
            { to: 9, duration: 120 },
            { to: -6, duration: 110 },
            { to: 6, duration: 100 },
            { to: 0, duration: 110 },
          ],
        },
        '-=260'
      );

      // 3) 좌상단으로 날아가 자리잡기
      tl.add(
        el,
        {
          left: to.left,
          top: to.top,
          fontSize: to.fontSize,
          padding: to.padding,
          translateX: '0%',
          translateY: '0%',
          scale: 1,
          duration: 820,
          ease: A.createSpring({ stiffness: 90, damping: 15 }),
          onComplete: () => {
            applyTo();
            if (onLanded) onLanded();
          },
        },
        `+=${holdMs}`
      );

      return tl;
    },

    /** 좌상단에 자리잡은 뒤 은은하게 계속 뛰는 심장박동 */
    idlePulse(el, options = {}) {
      if (!enabled || !el) return null;
      const { scale = 1.05, duration = 1.7 } = options;
      return M.animate(
        el,
        { scale: [1, scale, 1] },
        { duration, repeat: Infinity, ease: 'easeInOut' }
      );
    },

    /** 정답/오답/성공/실패를 화면 한가운데에 확 터뜨리기 */
    burstResult(inner, ring, options = {}) {
      if (!inner) return;
      const { angry = false } = options;

      if (!enabled) {
        inner.style.opacity = '1';
        inner.style.transform = 'none';
        if (ring) ring.style.opacity = '0';
        return;
      }

      A.set(inner, { opacity: 0, scale: 0.35, rotate: 0 });
      A.animate(inner, {
        opacity: 1,
        scale: [0.35, 1.12, 1],
        duration: 760,
        ease: 'outElastic(1, .5)',
      });

      if (angry) {
        A.animate(inner, {
          rotate: [
            { to: -4, duration: 70 },
            { to: 4, duration: 90 },
            { to: -3, duration: 80 },
            { to: 0, duration: 90 },
          ],
          delay: 180,
        });
      }

      if (ring) {
        A.set(ring, { opacity: 0.55, scale: 0.4 });
        A.animate(ring, {
          opacity: 0,
          scale: 2.4,
          duration: 700,
          ease: 'out(3)',
        });
      }
    },

    /** 팝업이 사라질 때 */
    fadeOutResult(inner, onDone) {
      if (!inner) return onDone && onDone();
      if (!enabled) {
        inner.style.opacity = '0';
        return onDone && onDone();
      }
      A.animate(inner, {
        opacity: 0,
        scale: 0.86,
        duration: 260,
        ease: 'in(2)',
        onComplete: () => onDone && onDone(),
      });
    },

    /** 오답일 때 요소를 좌우로 짧게 터는 효과 */
    shake(el, options = {}) {
      if (!el) return;
      if (!enabled) return;
      const { distance = 8 } = options;
      A.animate(el, {
        translateX: [
          { to: -distance, duration: 60 },
          { to: distance, duration: 80 },
          { to: -distance * 0.6, duration: 70 },
          { to: distance * 0.6, duration: 70 },
          { to: 0, duration: 70 },
        ],
      });
    },

    /** 정답 맞힌 선택지를 통통 튀게 */
    bounce(el) {
      if (!el || !enabled) return;
      A.animate(el, {
        scale: [
          { to: 1.22, duration: 180, ease: 'out(3)' },
          { to: 1, duration: 520, ease: 'outElastic(1, .4)' },
        ],
      });
    },

    /** 선택지 버튼들이 차례로 등장 */
    enterChoices(targets) {
      const els = toArray(targets);
      if (!els.length) return;
      if (!enabled) return clearTransform(els);
      A.set(els, { opacity: 0, translateY: 10, scale: 0.85 });
      A.animate(els, {
        opacity: 1,
        translateY: 0,
        scale: 1,
        duration: 520,
        delay: A.stagger(45),
        ease: A.createSpring({ stiffness: 220, damping: 14 }),
      });
    },
  };

  global.SMFAnim = SMFAnim;
})(window);
