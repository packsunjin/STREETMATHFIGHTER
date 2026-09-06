// 학생을 구분하기 위한 최소한의 장치.
// 로그인을 붙이면 아이디/비밀번호 관리 부담이 생기고 수업 중에 쓰기 번거로워서,
// 브라우저에 무작위 키 하나만 저장해두고 그걸로 "같은 기기 = 같은 학생"으로 본다.
// 이름은 선택이며, 선생님 화면에서 누가 누군지 알아보기 위한 표시용일 뿐이다.

const SMFStudent = (() => {
  const KEY_STORAGE = 'smf_student_key';
  const NAME_STORAGE = 'smf_student_name';

  function safeGet(storageKey) {
    try {
      return window.localStorage.getItem(storageKey);
    } catch (err) {
      return null; // 시크릿 모드 등에서 저장소를 못 쓰는 경우
    }
  }

  function safeSet(storageKey, value) {
    try {
      window.localStorage.setItem(storageKey, value);
    } catch (err) {
      /* 저장 못 해도 이번 세션 동안은 메모리 값으로 동작 */
    }
  }

  function createKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    // randomUUID가 없는 환경 대비
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  let cachedKey = safeGet(KEY_STORAGE);
  if (!cachedKey || !/^[A-Za-z0-9_-]{8,64}$/.test(cachedKey)) {
    cachedKey = createKey();
    safeSet(KEY_STORAGE, cachedKey);
  }

  let cachedName = safeGet(NAME_STORAGE) || '';

  return {
    getKey() {
      return cachedKey;
    },
    getName() {
      return cachedName;
    },
    setName(name) {
      cachedName = (name || '').trim().replace(/\s+/g, ' ').slice(0, 20);
      safeSet(NAME_STORAGE, cachedName);
      return cachedName;
    },
    /** 내 기록 요약 (푼 문제 수, 정답률, 연속 정답 등) */
    async fetchSummary() {
      const res = await fetch(`/api/me/summary?studentKey=${encodeURIComponent(cachedKey)}`);
      if (!res.ok) throw new Error('기록을 불러오지 못했습니다.');
      return res.json();
    },
    /** 오답 노트: 마지막에 틀린 채로 남아 있는 문제들 */
    async fetchWrongProblems() {
      const res = await fetch(`/api/me/wrong?studentKey=${encodeURIComponent(cachedKey)}`);
      if (!res.ok) throw new Error('오답 노트를 불러오지 못했습니다.');
      return res.json();
    },
  };
})();

window.SMFStudent = SMFStudent;
