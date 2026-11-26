/* 강당 진행 화면(show.html)의 동작 전부. 화면·필기·채점·소리가 여기 있다. */
(() => {
  const $ = (id) => document.getElementById(id);
  // 두 손가락은 문제 사진 확대에만 쓴다(캔버스가 처리). 브라우저가 페이지를 통째로
  // 확대해 버리면 제목과 '답 입력하기' 버튼이 화면 밖으로 밀려 손을 못 댄다.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault()),
  );
  const LEVELS = [
    { key: '1', id: 'easy', name: '하', time: 90, notes: ['기본 계산 중심', '여유 있는 풀이 시간'] },
    { key: '2', id: 'mid', name: '중', time: 180, notes: ['응용 한 단계 포함', '표준 시험 속도'] },
    { key: '3', id: 'hard', name: '상', time: 300, notes: ['다단계 추론 문항', '실전 최고 난도'] },
  ];
  const LABELS = {
    idle: '대기',
    difficulty: '난이도 선택',
    confirm: '제한시간 확인',
    countdown: '카운트다운',
    solve: '문제 풀이',
    grading: '채점',
    result: '결과',
  };
  const screens = ['idle', 'difficulty', 'confirm', 'countdown', 'solve', 'grading', 'result'];
  const state = {
    problems: [],
    level: 'mid',
    index: 0,
    question: null,
    used: new Set(),
    answer: '',
    picked: null,
    remain: 0,
    elapsed: 0,
    grade: 0,
    photoSize: null,
    panX: 0,
    panY: 0,
    tool: 'pen',
    retry: null,
    timedOut: false,
    score: 0,
    muted: false,
    pen: true,
    width: 5,
    zoom: 100,
    strokes: [],
    acts: [],
    redo: [],
    timer: null,
    cd: null,
  };
  const norm = (d) =>
    ({ 하: 'easy', 중: 'mid', 상: 'hard', easy: 'easy', mid: 'mid', hard: 'hard' })[
      String(d || '').toLowerCase()
    ] || d;
  function show(s) {
    screens.forEach((x) => $(x).classList.toggle('active', x === s));
    $('screenLabel').textContent = LABELS[s];
    if (s === 'solve')
      requestAnimationFrame(() => {
        initCanvas();
        rememberBoard();
      });
  }
  // ---- 소리 (시안 그대로)
  function beep(freq, dur, type) {
    if (state.muted) return;
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      const a = state.ac || (state.ac = new A());
      if (a.state === 'suspended') a.resume();
      const o = a.createOscillator(),
        g = a.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.06, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur);
    } catch (e) {}
  }
  async function loadProblems() {
    try {
      const r = await fetch('api/show/problems', { credentials: 'include' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      const rows = Array.isArray(d.problems) ? d.problems : [];
      state.noAnswer = (Array.isArray(d.noAnswer) ? d.noAnswer : []).map((p) => ({
        id: p.id,
        difficulty: norm(p.difficulty),
        title: p.title || '',
      }));
      state.problems = rows
        .filter((p) => p && p.imageUrl && p.answer !== null && p.answer !== undefined)
        .map((p) => {
          const type = p.questionType === 'objective' ? 'choice' : 'short';
          const ans = String(p.answer);
          const ai = Number(ans);
          return {
            id: p.id,
            image: p.imageUrl,
            type,
            answer: ans,
            choices: type === 'choice' ? ['1', '2', '3', '4', '5'] : [],
            correctIndex: Number.isInteger(ai) && ai >= 1 && ai <= 5 ? ai - 1 : 0,
            difficulty: norm(p.difficulty),
            unit: p.unit || '',
            title: p.title || '',
          };
        });
      state.loadError = null;
    } catch (e) {
      console.warn('실시간 문제 연동 실패', e);
      // 행사 중에 와이파이가 한 번 끊긴 채로 '시작'을 누르면 받아 둔 문제까지 날아가
      // 진행이 멈췄다. 이미 받은 게 있으면 그걸로 계속 간다.
      if (!state.problems.length) {
        state.noAnswer = [];
        state.loadError = String((e && e.message) || e);
      }
    }
    renderStatus();
  }
  function pool(level) {
    return state.problems.filter((p, i) => p.difficulty === level && !state.used.has(p.id));
  }
  function pick(level) {
    let p = pool(level);
    if (!p.length) {
      state.problems.filter((q) => q.difficulty === level).forEach((q) => state.used.delete(q.id));
      p = pool(level);
      // 한 바퀴 다 돌고 다시 섞을 때 방금 낸 문제가 바로 또 나오지 않게 한다
      if (p.length > 1 && state.lastId != null) p = p.filter((q) => q.id !== state.lastId);
    }
    if (!p.length) return null;
    const q = p[Math.floor(Math.random() * p.length)];
    state.lastId = q.id;
    return q;
  }
  function renderStatus() {
    const box = $('keyHelp');
    box.innerHTML = '';
    LEVELS.forEach((l) => {
      const n = state.problems.filter((p) => p.difficulty === l.id).length;
      const na = (state.noAnswer || []).filter((p) => p.difficulty === l.id).length;
      const left = pool(l.id).length;
      const d = document.createElement('div');
      d.textContent = `${l.name} (${l.key}) · ${state.loadError ? '서버 연결 실패' : n ? `${left ? left + '개' : '한 바퀴 돎'}${na ? ` (정답 없는 ${na}개 제외)` : ''}` : na ? `정답 미등록 ${na}개 — 쓸 수 없음` : '등록된 문제 없음'}`;
      box.appendChild(d);
    });
  }
  function renderLevels() {
    const wrap = $('levels');
    wrap.innerHTML = '';
    LEVELS.forEach((l) => {
      const b = document.createElement('button');
      b.style.cssText =
        'border:0;border-right:2px solid var(--color-text);background:var(--color-bg);color:var(--color-text);padding:clamp(18px,3vh,28px);display:flex;flex-direction:column;gap:12px;text-align:left;cursor:pointer;min-width:0';
      if (l.id === 'hard') b.style.borderRight = '0';
      b.innerHTML = `<div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase">Level ${l.key}</div><div style="font-size:12px;border:2px solid currentColor;padding:2px 8px;letter-spacing:.08em">${l.key}</div></div><div style="font-family:var(--font-heading);font-size:clamp(34px,8vh,64px);font-weight:800;line-height:.95;letter-spacing:-.03em">${l.name}</div><div style="display:flex;align-items:baseline;gap:8px"><div style="font-family:var(--font-heading);font-size:clamp(20px,3.4vh,28px);font-weight:800">${fmt(l.time)}</div><div style="font-size:12px;letter-spacing:.08em">제한시간</div></div><div style="margin-top:auto;display:flex;flex-direction:column;gap:5px"><div style="font-size:12px;line-height:1.45">${l.notes[0]}</div><div style="font-size:12px;line-height:1.45">${l.notes[1]}</div></div>`;
      b.onclick = () => chooseLevel(l.id);
      wrap.appendChild(b);
    });
  }
  function chooseLevel(level) {
    beep(880, 0.06);
    state.level = level;
    // 앞사람이 틀린 문제가 있으면 같은 난이도에서 그 문제를 그대로 다시 낸다.
    // 난이도를 바꿨다면 그 판은 넘어간 것으로 보고 새 문제를 뽑는다.
    if (state.retry && state.retry.difficulty !== level) state.retry = null;
    state.question = state.retry && state.retry.difficulty === level ? state.retry : pick(level);
    state.index = 0;
    if (!state.question) {
      const na = (state.noAnswer || []).filter((p) => p.difficulty === level);
      alert(
        state.loadError
          ? `문제를 불러오지 못했습니다 (${state.loadError}). 서버 연결을 확인하세요.`
          : na.length
            ? `이 난이도에 문제 ${na.length}개가 있지만 정답이 등록되어 있지 않아 쓸 수 없습니다.\n\n관리자 화면에서 정답을 넣어주세요: ${na.map((p) => p.title || '#' + p.id).join(', ')}`
            : '이 난이도에는 등록된 문제가 없습니다.',
      );
      return;
    }
    $('limitLabel').textContent = fmt(levelObj().time);
    $('levelName').textContent = '난이도 ' + levelObj().name;
    $('confirmStats').innerHTML =
      `<div style="padding:16px;border-right:2px solid var(--color-divider)"><div style="font-size:11px;letter-spacing:.1em">유형</div><div style="font-family:var(--font-heading);font-size:26px;font-weight:800">${state.question.type === 'choice' ? '객관식' : '주관식'}</div></div><div style="padding:16px;border-right:2px solid var(--color-divider)"><div style="font-size:11px;letter-spacing:.1em">단원</div><div style="font-family:var(--font-heading);font-size:20px;font-weight:800">${state.question.unit || '—'}</div></div><div style="padding:16px"><div style="font-size:11px;letter-spacing:.1em">남은 문제</div><div style="font-family:var(--font-heading);font-size:26px;font-weight:800">${pool(level).filter((p) => p.id !== state.question.id).length}개</div></div>`;
    $('levelNotes').innerHTML = levelObj()
      .notes.map((n) => `<div style="font-size:13px;line-height:1.5">${n}</div>`)
      .join('');
    show('confirm');
  }
  const levelObj = () => LEVELS.find((x) => x.id === state.level);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function startCountdown() {
    show('countdown');
    let n = 3;
    $('countdownNum').textContent = n;
    beep(660, 0.12);
    clearInterval(state.cd);
    state.cd = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(state.cd);
        beep(990, 0.2);
        showSolve();
      } else {
        $('countdownNum').textContent = n;
        beep(660, 0.12);
      }
    }, 900);
  }
  function showSolve() {
    if (!state.question) return;
    show('solve');
    state.answer = '';
    state.picked = null;
    state.remain = levelObj().time;
    state.elapsed = 0;
    state.strokes = [];
    state.acts = [];
    state.redo = [];
    state.zoom = 100;
    state.panX = 0;
    state.panY = 0;
    setTool('pen');
    $('answerPanel').style.display = 'none';
    $('answerOpenWrap').style.display = 'block';
    makeChoices();
    renderAnswer();
    updateSolveUI();
    loadQuestionImage();
    initCanvas();
    startTimer();
    beep(523, 0.1, 'square');
    setTimeout(() => beep(784, 0.16, 'square'), 110);
  }
  function startTimer() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      state.remain--;
      state.elapsed++;
      updateSolveUI();
      if (state.remain <= 10 && state.remain > 0) beep(1180, 0.09, 'square');
      else if (state.remain > 10) beep(state.remain % 2 === 0 ? 700 : 620, 0.035, 'square');
      if (state.remain <= 0) {
        clearInterval(state.timer);
        beep(300, 0.5, 'sawtooth');
        setTimeout(() => beep(200, 0.6, 'sawtooth'), 260);
        submit(true);
      }
    }, 1000);
  }
  function updateSolveUI() {
    $('clock').textContent = state.remain <= 0 ? '0:00' : fmt(state.remain);
    $('gauge').style.width = Math.max(0, (state.remain / levelObj().time) * 100) + '%';
    $('modeLabel').textContent = state.question.type === 'choice' ? '객관식' : '주관식';
    $('unitName').textContent = state.question.unit || '';
    renderScore();
  }
  function renderScore() {
    $('scoreLabel').textContent = '정답 ' + Math.floor((state.score || 0) / 10);
  }
  // 확대/축소에 위 한계를 두지 않는다. 강당 뒤에서 안 보이면 얼마든지 키운다.
  // 아래로만 바닥을 둔다(0%가 되면 사진이 사라져서 되돌릴 방법이 없다).
  const ZOOM_MIN = 5;
  const zoomBy = (f) => setZoom(state.zoom * f);
  // 사진 크기를 알아야 "판에 다 들어오는 크기"를 계산할 수 있다. 배경 이미지는
  // 크기를 알려주지 않으므로 같은 주소로 한 장 더 띄워서 원본 픽셀을 잰다
  // (브라우저 캐시에서 나오므로 사진을 두 번 받지는 않는다).
  function loadQuestionImage() {
    const q = state.question;
    // 사진은 크기를 안 다음에야 띄운다. 먼저 띄우면 판 전체 크기로 0.1초쯤 번쩍
    // 보였다가 제 크기로 줄어들었다.
    $('questionImg').style.backgroundImage = 'none';
    state.photoSize = null;
    const probe = new Image();
    probe.onload = () => {
      if (state.question === q) {
        state.photoSize = { w: probe.naturalWidth, h: probe.naturalHeight };
        centerPhoto();
        applyZoom();
        $('questionImg').style.backgroundImage = `url(${JSON.stringify(q.image)})`;
      }
    };
    // 사진을 못 받으면 빈 판만 남아서 무슨 일인지 알 수 없었다. 판 위에 이유를 띄운다
    // (그 사이에도 타이머와 필기는 그대로 돈다).
    probe.onerror = () => {
      if (state.question === q) photoNote('문제 사진을 불러오지 못했습니다 — 인터넷 연결을 확인하세요');
    };
    photoNote('');
    probe.src = q.image;
    applyZoom();
  }
  function photoNote(text) {
    let n = $('photoNote');
    if (!n) {
      n = document.createElement('div');
      n.id = 'photoNote';
      n.style.cssText =
        'position:absolute;left:16px;top:16px;z-index:5;border:2px solid var(--color-accent);background:var(--color-bg);color:var(--color-accent-700);padding:10px 14px;font-weight:700;pointer-events:none';
      $('boardWrap').appendChild(n);
    }
    n.textContent = text;
    n.style.display = text ? 'block' : 'none';
  }
  // 100%는 사진이 판의 가로 60% · 세로 65% 안에 통째로 들어오는 크기다.
  // 예전에는 판 전체에 맞췄는데, 가로로 긴 교과서 캡처가 판 너비를 다 먹어서 글자가
  // 지나치게 크고 풀 자리가 없었다. 작은 캡처를 원래보다 1.5배 넘게 늘리지도 않는다
  // (늘릴수록 흐려진다). 더 크게 봐야 하면 +나 두 손가락으로 키운다.
  const PHOTO_FIT = { w: 0.6, h: 0.65, maxScale: 1.5 };
  // 지금 판에 그려지는 사진의 크기(px)
  function photoBox() {
    const box = $('boardWrap'),
      p = state.photoSize;
    if (!p || !p.w || !p.h || !box.clientWidth || !box.clientHeight) return null;
    const fit =
      (Math.min(
        (box.clientWidth * PHOTO_FIT.w) / p.w,
        (box.clientHeight * PHOTO_FIT.h) / p.h,
        PHOTO_FIT.maxScale,
      ) *
        state.zoom) /
      100;
    return { w: p.w * fit, h: p.h * fit };
  }
  // 사진은 판 한가운데에 놓고 시작한다. 왼쪽 위에 붙여 두면 넓은 화면에서
  // 한쪽 구석에 박힌 것처럼 보인다.
  function centerPhoto() {
    const b = photoBox(),
      box = $('boardWrap');
    if (!b) return false;
    state.panX = (box.clientWidth - b.w) / 2;
    state.panY = (box.clientHeight - b.h) / 2;
    return true;
  }
  function applyZoom() {
    const el = $('questionImg'),
      b = photoBox();
    if (b) {
      el.style.backgroundSize = `${b.w}px ${b.h}px`;
      el.style.backgroundPosition = `${Math.round(state.panX)}px ${Math.round(state.panY)}px`;
    } else {
      // 사진 크기를 아직 모르는 짧은 순간. 브라우저가 판에 맞춰 주는 값으로 버틴다.
      el.style.backgroundSize = state.zoom === 100 ? 'contain' : 'auto ' + state.zoom + '%';
      el.style.backgroundPosition = 'center center';
    }
    $('zoomLabel').textContent = state.zoom + '%';
  }
  // 확대는 기준점(손가락 가운데, 없으면 판 한가운데)을 붙잡고 한다.
  // 그래야 키우는 동안 보고 있던 곳이 화면 밖으로 달아나지 않는다.
  function setZoom(next, fx, fy) {
    const z = Math.max(ZOOM_MIN, Math.round(next));
    if (z === state.zoom) return;
    const before = photoBox();
    state.zoom = z;
    const after = photoBox();
    if (before && after && before.w > 0) {
      const box = $('boardWrap'),
        k = after.w / before.w;
      const cx = fx == null ? box.clientWidth / 2 : fx,
        cy = fy == null ? box.clientHeight / 2 : fy;
      state.panX = cx - (cx - state.panX) * k;
      state.panY = cy - (cy - state.panY) * k;
    }
    applyZoom();
  }
  function panBy(dx, dy) {
    state.panX += dx;
    state.panY += dy;
    applyZoom();
  }
  // 사진을 판에 맞춰 한가운데로 되돌린다
  function resetView() {
    state.zoom = 100;
    if (!centerPhoto()) {
      state.panX = 0;
      state.panY = 0;
    }
    applyZoom();
  }
  function renderAnswer() {
    $('answerDisplay').textContent = state.answer || '';
    document
      .querySelectorAll('.choice-btn')
      .forEach(
        (b) => (b.style.background = b.dataset.i == state.picked ? 'var(--color-accent)' : 'transparent'),
      );
    $('shortPanel').style.display = state.question && state.question.type === 'short' ? 'flex' : 'none';
    $('choicePanel').style.display = state.question && state.question.type === 'choice' ? 'grid' : 'none';
    $('panelMode').textContent = state.question && state.question.type === 'choice' ? '객관식' : '주관식';
  }
  function makeKeypad() {
    const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '.', '/', '-', '⌫', 'C'];
    const box = $('keypad');
    box.innerHTML = '';
    keys.forEach((k) => {
      const b = document.createElement('button');
      b.textContent = k;
      b.style.cssText =
        'border:2px solid var(--color-divider);background:transparent;padding:0;font-size:clamp(14px,2.2vh,19px);font-weight:700;cursor:pointer;min-height:0'; // click은 누른 곳과 뗀 곳이 같아야 발생한다. 전자칠판에서 손가락이 조금만
      // 미끄러져도 입력이 통째로 씹혔다. 계산기처럼 누르는 순간 들어가게 한다.
      b.onpointerdown = (e) => {
        e.preventDefault();
        flash(b);
        if (k === 'C') state.answer = '';
        else if (k === '⌫') state.answer = state.answer.slice(0, -1);
        else if (state.answer.length < 24) {
          beep(1200, 0.03);
          state.answer += k;
        }
        renderAnswer();
      };
      box.appendChild(b);
    });
  }
  // 눌린 표시를 잠깐 켠다. 시간으로 끄니까 손가락을 어디서 떼든 안 남는다.
  function flash(b) {
    b.classList.add('pressed');
    clearTimeout(b._f);
    b._f = setTimeout(() => b.classList.remove('pressed'), 130);
  }
  function makeChoices() {
    const box = $('choicePanel');
    box.innerHTML = '';
    (state.question?.choices || []).forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.dataset.i = i;
      b.textContent = c;
      b.style.cssText =
        'border:2px solid var(--color-divider);background:transparent;padding:0;font-size:clamp(18px,3vh,28px);font-weight:700;cursor:pointer';
      b.onpointerdown = (e) => {
        e.preventDefault();
        flash(b);
        beep(1200, 0.03);
        state.picked = i;
        renderAnswer();
      };
      box.appendChild(b);
    });
  }
  // 주관식 답을 견준다. 글자가 달라도 같은 수면 맞다("0.4"="2/5"=".4", "3/4"="0.75", "08"="8").
  // 예전에는 글자 그대로만 견줘서, 맞게 푼 학생이 강당 앞에서 오답 판정을 받았다.
  function toNumber(v) {
    const t = String(v ?? '')
      .trim()
      .replace(/\s+/g, '');
    if (!t) return NaN;
    const m = t.match(/^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/);
    if (m) {
      const d = Number(m[2]);
      return d ? Number(m[1]) / d : NaN;
    }
    return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
  }
  function sameAnswer(typed, correct) {
    const a = String(typed ?? '')
        .trim()
        .replace(/\s+/g, ''),
      b = String(correct ?? '')
        .trim()
        .replace(/\s+/g, '');
    if (a === b) return true;
    const x = toNumber(a),
      y = toNumber(b);
    return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y));
  }
  function submit(timeout = false) {
    // 아무것도 안 넣고 제출을 누르면(손이 스쳤거나 Enter를 먼저 눌렀거나) 오답으로 처리돼
    // 그 학생 기회가 날아갔다. 시간이 다 된 경우가 아니면 빈 답은 받지 않는다.
    if (
      !timeout &&
      state.question &&
      (state.question.type === 'choice' ? state.picked == null : !state.answer.trim())
    ) {
      beep(220, 0.08, 'sawtooth');
      return;
    }
    clearInterval(state.timer);
    state.timedOut = timeout;
    state.answer = state.answer.trim();
    const q = state.question;
    const ok =
      !timeout &&
      (q.type === 'choice' ? state.picked === q.correctIndex : sameAnswer(state.answer, q.answer));
    state.correct = ok;
    state.score = (state.score || 0) + (ok ? 10 : 0);
    $('gradingMode').textContent = q.type === 'choice' ? '객관식' : '주관식';
    $('gradingAnswer').textContent = state.answer || (state.picked != null ? String(state.picked + 1) : '—');
    $('gradingElapsed').textContent = fmt(state.elapsed);
    $('gradeBar').style.width = '0%';
    $('gradeStep').textContent = '답안 확인';
    show('grading');
    let p = 0;
    clearInterval(state.gradeTimer);
    state.gradeTimer = setInterval(() => {
      p += 20;
      $('gradeBar').style.width = p + '%';
      $('gradeStep').textContent = p < 60 ? '계산 중' : p < 100 ? '판정 중' : '완료';
      if (p >= 100) {
        clearInterval(state.gradeTimer);
        beep(ok ? 1046 : 220, ok ? 0.25 : 0.35, ok ? 'triangle' : 'sawtooth');
        showResult(ok, timeout);
      }
    }, 120);
  }
  // 오답이면 정답을 가린다. 같은 문제를 다음 사람이 푸는데 여기서 답을 띄우면
  // 강당에 앉은 학생들이 그대로 베껴 쓴다. 맞혔거나 시간이 다 됐을 때만 공개한다.
  function showResult(ok, timeout) {
    const q = state.question;
    // 맞혔거나 시간이 다 된 문제는 끝난 문제다. 틀린 문제는 다음 사람이 "그 문제를" 다시 푼다.
    // 예전에는 이걸 '다음' 버튼에서 했다. 그래서 결과 화면에서 Esc로 나가면 맞힌 문제가
    // 다시 뽑혔고, '다음'이 두 번 눌리면 맞힌 문제가 '다시 풀 문제'로 잡혔다.
    if (ok || timeout) {
      state.used.add(q.id);
      if (state.retry && state.retry.id === q.id) state.retry = null;
    } else state.retry = q;
    show('result');
    const reveal = ok || timeout;
    $('resultTyped').textContent = state.answer || (state.picked != null ? String(state.picked + 1) : '—');
    $('resultCorrect').textContent = reveal
      ? q.type === 'choice'
        ? String(q.correctIndex + 1)
        : q.answer
      : '—';
    $('resultElapsed').textContent = fmt(state.elapsed);
    $('verdict').textContent = timeout ? '시간 종료' : ok ? '정답' : '오답';
    $('verdict').style.background = ok ? 'var(--color-accent)' : 'var(--color-text)';
    $('prizeLabel').textContent = ok ? '상품 지급' : timeout ? '시간 종료' : '다음 사람';
    $('prizeNote').textContent = ok
      ? '정답 — 상품을 받아가세요'
      : timeout
        ? '시간 종료 — 정답을 확인하세요'
        : '오답 — 정답은 가려 둡니다. 같은 문제를 다음 사람이 풉니다';
    $('nextBtn').textContent = reveal ? '다음 문제' : '다음 사람';
    renderScore();
  }
  // 다음 사람은 난이도 고르는 화면부터 다시 시작한다.
  // 바로 풀이로 들어가면 학생이 앞으로 나오는 동안 타이머가 이미 돌아간다.
  function next() {
    const q = state.question;
    // 맞혔거나 시간이 다 된 문제는 끝난 문제다. 틀린 문제는 같은 사람이 아니라
    // 다음 사람이 "그 문제를" 다시 푼다(화면이 그렇게 약속했다). 그래서 들고 있는다.
    state.answer = '';
    state.picked = null;
    state.correct = null;
    state.timedOut = false;
    state.elapsed = 0;
    renderStatus();
    renderLevels();
    show('difficulty');
  }
  // 카운트다운·채점 막대 타이머도 같이 멈춘다. 안 그러면 Esc로 대기 화면에 나와도
  // 몇 초 뒤 풀이/결과 화면이 저절로 다시 튀어나왔다.
  function toIdle() {
    clearInterval(state.timer);
    clearInterval(state.cd);
    clearInterval(state.gradeTimer);
    show('idle');
    renderStatus();
  }
  function initCanvas() {
    const c = $('canvas'),
      w = $('boardWrap');
    const rect = w.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = devicePixelRatio || 1;
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAll();
  }
  // 지금 펜인지 지우개인지 버튼에 표시한다. 예전에는 눌러도 생김새가 그대로여서
  // 지우개를 쥔 줄 모르고 계속 그었다.
  const TOOL_ON =
    'border:2px solid var(--color-text);background:var(--color-text);color:var(--color-bg);padding:6px 10px;font-size:12px;cursor:pointer';
  const TOOL_OFF =
    'border:2px solid var(--color-divider);background:transparent;padding:6px 10px;font-size:12px;cursor:pointer';
  function setTool(t) {
    state.tool = t;
    state.pen = t === 'pen';
    $('penBtn').style.cssText = t === 'pen' ? TOOL_ON : TOOL_OFF;
    $('eraserBtn').style.cssText = t === 'eraser' ? TOOL_ON : TOOL_OFF;
    $('moveBtn').style.cssText = t === 'move' ? TOOL_ON : TOOL_OFF;
    $('canvas').style.cursor = t === 'move' ? 'grab' : 'crosshair';
  }
  function pos(e) {
    const r = $('canvas').getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  let drawing = false,
    moving = false,
    last = null;
  // 손가락 하나면 펜/지우개, 둘 이상이면 문제 확대/축소(벌렸다 오므렸다).
  const pts = new Map();
  let pinch = null,
    strokeSeq = 0,
    erasing = false,
    erased = [];
  const gap = () => {
    const [a, b] = [...pts.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  // 두 손가락 가운데(판 기준 좌표). 확대의 기준점이자 이동량의 잣대다.
  const mid = () => {
    const [a, b] = [...pts.values()];
    const r = $('canvas').getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  };

  // 지우개는 획 단위다. 스친 획을 통째로 지운다.
  // 픽셀을 파내던 예전 방식은 획을 반 토막 내고 지운 자리가 얼룩처럼 남았다.
  // 크기는 고정이다. 펜 굵기 슬라이더는 펜에만 쓴다(지우다가 펜이 굵어지지 않는다).
  const ERASER_R = 18;
  const segDist = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1,
      dy = y2 - y1,
      L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };
  // 조각 순서는 안정 정렬이 지켜 준다(같은 획 안에서는 밀리지 않는다)
  const byStroke = (list) => list.sort((a, b) => a.sid - b.sid);
  function eraseAt(p) {
    const r = $('canvas').getBoundingClientRect();
    if (!r.width || !r.height) return;
    const hit = new Set();
    state.strokes.forEach((s) => {
      if (hit.has(s.sid)) return;
      if (
        segDist(p.x, p.y, s.x1 * r.width, s.y1 * r.height, s.x2 * r.width, s.y2 * r.height) <=
        ERASER_R + s.w / 2
      )
        hit.add(s.sid);
    });
    if (!hit.size) return;
    erased = erased.concat(state.strokes.filter((s) => hit.has(s.sid)));
    state.strokes = state.strokes.filter((s) => !hit.has(s.sid));
    drawAll();
  }

  // 손바닥 걸러내기. 전자칠판에 펜으로 쓰면 손바닥이 같이 닿는데, 예전에는 그게
  // "두 번째 손가락"으로 잡혀서 쓰던 획이 지워지고 사진이 확대됐다.
  // 펜이 닿아 있거나 방금 뗐으면 손가락 터치는 통째로 무시한다.
  const PALM_MS = 800;
  let lastPen = 0;
  const penDown = () => [...pts.values()].some((p) => p.pen);
  const ignoreTouch = (e) => e.pointerType === 'touch' && (penDown() || Date.now() - lastPen < PALM_MS);
  $('canvas').addEventListener('pointerdown', (e) => {
    if (ignoreTouch(e)) return;
    if (e.pointerType === 'pen') {
      lastPen = Date.now();
      // 손바닥이 펜보다 먼저 닿았으면 그 손바닥이 그은 것을 지우고 펜으로 시작한다
      if (pts.size) {
        if (drawing) state.strokes = state.strokes.filter((s) => s.sid !== strokeSeq);
        if (erasing && erased.length) state.strokes = byStroke(state.strokes.concat(erased));
        pts.clear();
        pinch = null;
        drawing = false;
        erasing = false;
        moving = false;
        erased = [];
        drawAll();
      }
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pen: e.pointerType === 'pen' });
    $('canvas').setPointerCapture(e.pointerId);
    if (pts.size === 1) {
      last = pos(e);
      // 이동은 사진만 옮긴다. 필기는 판에 그대로 있는다.
      if (state.tool === 'move') {
        moving = true;
        $('canvas').style.cursor = 'grabbing';
        return;
      }
      beep(1200, 0.03);
      state.redo = [];
      // 획 하나는 선 조각 수십 개로 쌓인다. 되돌리기가 획 단위로 돌도록 번호를 매긴다.
      if (state.tool === 'pen') {
        drawing = true;
        strokeSeq++;
      } else {
        erasing = true;
        erased = [];
        eraseAt(last);
      }
    } else if (pts.size === 2) {
      // 두 번째 손가락이 닿으면 확대다. 첫 손가락이 그은 것도, 지운 것도 되돌린다.
      if (drawing) state.strokes = state.strokes.filter((s) => s.sid !== strokeSeq);
      if (erasing && erased.length) {
        state.strokes = byStroke(state.strokes.concat(erased));
        erased = [];
      }
      drawing = false;
      erasing = false;
      moving = false;
      last = null;
      drawAll();
      pinch = { gap: gap(), zoom: state.zoom, mid: mid(), panX: state.panX, panY: state.panY };
    }
  });
  $('canvas').addEventListener('pointermove', (e) => {
    // 걸러낸 손바닥이 움직여도 펜 획에 끼어들면 안 된다
    if (!pts.has(e.pointerId)) return;
    if (e.pointerType === 'pen') lastPen = Date.now();
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pen: e.pointerType === 'pen' });
    if (pinch && pts.size >= 2) {
      // 벌린 만큼 키우고, 두 손가락 가운데가 움직인 만큼 사진도 따라 옮긴다.
      // 손가락 사이에 잡힌 지점이 계속 손가락 사이에 남는다.
      if (pinch.gap > 0) {
        const z = Math.max(ZOOM_MIN, Math.round((pinch.zoom * gap()) / pinch.gap)),
          m = mid(),
          k = z / pinch.zoom;
        state.zoom = z;
        state.panX = m.x - (pinch.mid.x - pinch.panX) * k;
        state.panY = m.y - (pinch.mid.y - pinch.panY) * k;
        applyZoom();
      }
      return;
    }
    if (moving) {
      const p = pos(e);
      panBy(p.x - last.x, p.y - last.y);
      last = p;
      return;
    }
    if (erasing) {
      const p = pos(e);
      eraseAt(p);
      last = p;
      return;
    }
    if (!drawing) return;
    const p = pos(e);
    const r = $('canvas').getBoundingClientRect();
    if (r.width && r.height)
      state.strokes.push({
        sid: strokeSeq,
        x1: last.x / r.width,
        y1: last.y / r.height,
        x2: p.x / r.width,
        y2: p.y / r.height,
        w: state.width,
      });
    last = p;
    drawAll();
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    $('canvas').addEventListener(ev, (e) => {
      // 걸러낸 손바닥을 뗄 때 쓰던 펜 획이 끊기면 안 된다
      if (!pts.has(e.pointerId)) return;
      if (e.pointerType === 'pen') lastPen = Date.now();
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      // 한 번에 그은 획, 한 번에 문질러 지운 획들을 각각 한 걸음으로 기록한다.
      if (drawing && state.strokes.some((s) => s.sid === strokeSeq))
        state.acts.push({ t: 'd', sid: strokeSeq });
      if (erasing && erased.length) state.acts.push({ t: 'e', segs: erased });
      erased = [];
      // 확대하다 손가락 하나를 떼도 남은 손가락으로 갑자기 선이 그어지면 안 된다
      drawing = false;
      erasing = false;
      moving = false;
      last = null;
      if (state.tool === 'move') $('canvas').style.cursor = 'grab';
    }),
  );
  // 획은 판 대비 비율로 들고 있다. 판이 커지거나 작아져도 사진 위 같은 자리에 남는다.
  function drawAll() {
    const c = $('canvas'),
      ctx = c.getContext('2d'),
      r = c.getBoundingClientRect();
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#201e1d';
    state.strokes.forEach((s) => {
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x1 * r.width, s.y1 * r.height);
      ctx.lineTo(s.x2 * r.width, s.y2 * r.height);
      ctx.stroke();
    });
  }
  $('penBtn').onclick = () => setTool('pen');
  $('eraserBtn').onclick = () => setTool('eraser');
  $('moveBtn').onclick = () => setTool('move');
  $('widthInput').oninput = (e) => {
    state.width = +e.target.value;
    $('widthLabel').textContent = '펜 ' + state.width + 'px';
  };
  // 되돌리기는 걸음 단위다: 그은 획 하나, 또는 한 번에 문질러 지운 획들.
  $('undoBtn').onclick = () => {
    const a = state.acts.pop();
    if (!a) return;
    if (a.t === 'd') {
      const segs = state.strokes.filter((s) => s.sid === a.sid);
      state.strokes = state.strokes.filter((s) => s.sid !== a.sid);
      state.redo.push({ t: 'd', sid: a.sid, segs });
    } else {
      state.strokes = byStroke(state.strokes.concat(a.segs));
      state.redo.push(a);
    }
    drawAll();
  };
  $('redoBtn').onclick = () => {
    const a = state.redo.pop();
    if (!a) return;
    if (a.t === 'd') {
      state.strokes = byStroke(state.strokes.concat(a.segs));
      state.acts.push({ t: 'd', sid: a.sid });
    } else {
      const ids = new Set(a.segs.map((s) => s.sid));
      state.strokes = state.strokes.filter((s) => !ids.has(s.sid));
      state.acts.push(a);
    }
    drawAll();
  };
  // 전체 지우기도 되돌릴 수 있다. 예전에는 기록까지 통째로 버려서, 'C'를 잘못 누르거나
  // 버튼이 스치면 학생이 쓴 풀이가 영영 사라졌다. 한 번에 문질러 지운 것과 똑같이 기록한다.
  $('clearBtn').onclick = () => {
    if (!state.strokes.length) return;
    state.acts.push({ t: 'e', segs: state.strokes });
    state.strokes = [];
    state.redo = [];
    drawAll();
  };
  $('zoomIn').onclick = () => zoomBy(1.15);
  $('zoomOut').onclick = () => zoomBy(1 / 1.15);
  $('zoomReset').onclick = resetView;
  $('openAnswer').onclick = () => {
    $('answerPanel').style.display = 'flex';
    $('answerOpenWrap').style.display = 'none';
    renderAnswer();
  };
  $('closeAnswer').onclick = () => {
    $('answerPanel').style.display = 'none';
    $('answerOpenWrap').style.display = 'block';
  };
  $('submitBtn').onclick = () => submit(false);
  $('startBtn').onclick = async () => {
    // 처음 열 때 서버가 자고 있었으면(Render 무료 플랜) 목록을 못 받은 채로 남았다.
    // 시작할 때마다 다시 받는다. 관리 화면에서 방금 고친 문제도 바로 반영된다.
    if (state.loading) return;
    state.loading = true;
    try {
      await loadProblems();
    } finally {
      state.loading = false;
    }
    renderLevels();
    show('difficulty');
  };
  $('diffBack').onclick = () => show('idle');
  $('confirmGo').onclick = startCountdown;
  $('confirmBack').onclick = () => show('difficulty');
  $('nextBtn').onclick = next;
  $('idleBtn').onclick = toIdle;
  $('muteBtn').onclick = () => {
    state.muted = !state.muted;
    $('muteBtn').textContent = state.muted ? '소리 꺼짐' : '소리 켜짐';
  };
  $('fullBtn').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };
  const on = (id) => $(id).classList.contains('active');
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd/Alt가 같이 눌린 건 브라우저 단축키다. 예전에는 Ctrl+C(복사)가 칠판을
    // 통째로 지우고, Ctrl+R(새로고침)이 '다시'를, Ctrl+F(찾기)가 전체화면을 눌렀다.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key,
      lower = k.toLowerCase();
    if (lower === 'f') {
      $('fullBtn').click();
      return;
    }
    if (k === 'Escape') {
      if (document.fullscreenElement) return;
      // 버튼에 적힌 대로 "뒤로" 한 칸만 간다. 예전에는 어디서든 대기 화면으로 튀었고,
      // 풀이 중에 답 패널을 닫으려고 Esc를 누르면 그 판이 통째로 날아갔다.
      if (on('difficulty')) toIdle();
      else if (on('confirm')) show('difficulty');
      else if (on('countdown')) {
        clearInterval(state.cd);
        show('confirm');
      } else if (on('solve')) {
        if ($('answerPanel').style.display === 'flex') $('closeAnswer').click();
      } else if (on('result')) toIdle();
      return;
    }
    if (k === 'Enter') {
      // 마지막으로 누른 버튼에 포커스가 남아 있으면 브라우저도 그 버튼을 한 번 더 누른다.
      // 결과 화면에서 '다음'이 두 번 눌려, 맞힌 문제가 다시 나오는 일이 있었다.
      const open = $('answerPanel').style.display === 'flex';
      if (on('idle') || on('confirm') || on('result') || (on('solve') && open)) e.preventDefault();
      if (on('idle')) $('startBtn').click();
      else if (on('confirm')) $('confirmGo').click();
      else if (on('result')) $('nextBtn').click();
      else if (on('solve') && open) $('submitBtn').click();
      return;
    }
    if (on('difficulty') && ['1', '2', '3'].includes(k)) {
      chooseLevel(LEVELS[+k - 1].id);
      return;
    }
    if (!on('solve')) return;
    const open = $('answerPanel').style.display === 'flex';
    if (lower === 'a') {
      $(open ? 'closeAnswer' : 'openAnswer').click();
      return;
    }
    if (lower === 'e') {
      setTool(state.tool === 'eraser' ? 'pen' : 'eraser');
      return;
    }
    if (lower === 'm') {
      setTool(state.tool === 'move' ? 'pen' : 'move');
      return;
    }
    if (lower === 'u') {
      $('undoBtn').click();
      return;
    }
    if (lower === 'r') {
      $('redoBtn').click();
      return;
    }
    if (lower === 'c') {
      $('clearBtn').click();
      return;
    }
    // 답 패널이 열려 있으면 화면 숫자판 말고 물리 키보드로도 넣는다.
    if (!open) return;
    if (state.question && state.question.type === 'choice') {
      if (/^[1-5]$/.test(k)) {
        state.picked = +k - 1;
        renderAnswer();
      }
      return;
    }
    if (/^[0-9]$/.test(k) || k === '.' || k === '/' || k === '-') {
      if (state.answer.length < 24) {
        state.answer += k;
        renderAnswer();
      }
      return;
    }
    if (k === 'Backspace') {
      e.preventDefault();
      state.answer = state.answer.slice(0, -1);
      renderAnswer();
    }
  });
  // 판 크기가 바뀌면(전체화면 켜고 끄기 등) 필기는 판 비율대로 늘어난다. 사진 위치도
  // 같은 비율로 옮겨야 학생이 사진 위에 쓴 표시가 사진에서 떨어지지 않는다.
  let boardSize = null;
  window.addEventListener('resize', () => {
    if (!on('solve')) return;
    const w = $('boardWrap');
    if (boardSize && boardSize.w && boardSize.h) {
      state.panX *= w.clientWidth / boardSize.w;
      state.panY *= w.clientHeight / boardSize.h;
    }
    boardSize = { w: w.clientWidth, h: w.clientHeight };
    initCanvas();
    applyZoom();
  });
  // 풀이 화면에 들어올 때마다 기준 크기를 다시 잡는다
  const rememberBoard = () => {
    const w = $('boardWrap');
    boardSize = { w: w.clientWidth, h: w.clientHeight };
  };
  makeKeypad();
  show('idle');
  loadProblems();
})();
