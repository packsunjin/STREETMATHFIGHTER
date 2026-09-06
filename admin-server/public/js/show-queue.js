/* 라운드 기록을 절대 잃지 않기 위한 저장 큐.
 *
 * 행사 중에는 되돌릴 방법이 없다. 강당에 학생들이 앉아 있는 상태에서
 * 와이파이가 잠깐 끊기거나 세션이 만료됐다고 "누가 상 받았는지"가 사라지면
 * 그걸 다시 물어볼 수도 없다.
 *
 * 그래서 서버 전송이 실패하면 브라우저에 넣어두고 계속 다시 보낸다.
 * 새로고침하거나 전자칠판이 꺼졌다 켜져도 남아 있게 localStorage를 쓴다.
 */
window.SMFQueue = (function () {
  const KEY = 'smf_pending_rounds';
  const RETRY_MS = 15000;

  let onStatus = () => {};
  let sending = false;

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      return []; // 저장소를 못 읽는 브라우저에서도 진행 자체는 막지 않는다
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (err) {
      /* 용량 초과 등. 메모리에만 남아도 이번 세션 동안은 재시도된다 */
    }
  }

  function pendingCount() {
    return read().length;
  }

  async function post(round) {
    const res = await fetch('api/show/rounds', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(round),
    });
    if (!res.ok) {
      const error = new Error(`기록 전송 실패 (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }

  /** 밀린 기록을 앞에서부터 보낸다. 하나라도 실패하면 거기서 멈추고 다음 기회에. */
  async function flush() {
    if (sending) return;
    sending = true;
    try {
      let list = read();
      while (list.length) {
        try {
          await post(list[0]);
        } catch (err) {
          onStatus({ pending: list.length, lastError: err });
          return;
        }
        list = read().slice(1); // 보내는 사이에 새로 쌓였을 수 있으니 다시 읽는다
        write(list);
        onStatus({ pending: list.length, lastError: null });
      }
    } finally {
      sending = false;
    }
  }

  /**
   * 한 라운드를 저장한다.
   * 바로 보내보고, 실패하면 큐에 넣어 계속 재시도한다.
   * 어느 쪽이든 진행은 멈추지 않으므로 항상 성공으로 끝난다.
   */
  async function save(round) {
    if (pendingCount() > 0) {
      // 앞에 밀린 게 있으면 순서를 지켜 뒤에 붙인다
      write([...read(), round]);
      flush();
      return { queued: true };
    }

    try {
      const result = await post(round);
      onStatus({ pending: 0, lastError: null });
      return { queued: false, id: result.id };
    } catch (err) {
      write([...read(), round]);
      onStatus({ pending: pendingCount(), lastError: err });
      return { queued: true };
    }
  }

  function init(options = {}) {
    onStatus = options.onStatus || (() => {});
    setInterval(flush, RETRY_MS);
    // 끊겼던 네트워크가 돌아오면 기다리지 않고 바로 보낸다
    window.addEventListener('online', flush);
    flush();
    onStatus({ pending: pendingCount(), lastError: null });
  }

  return { init, save, flush, pendingCount };
})();
