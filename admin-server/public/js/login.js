(async function checkExistingSession() {
  try {
    const res = await fetch('api/me', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated) {
      window.location.href = 'dashboard.html';
    }
  } catch (err) {
    // 무시하고 로그인 화면 그대로 노출
  }
})();

const form = document.getElementById('loginForm');
const errorMsg = document.getElementById('errorMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorMsg.textContent = data.error || '로그인에 실패했습니다.';
      return;
    }

    window.location.href = 'dashboard.html';
  } catch (err) {
    errorMsg.textContent = '서버에 연결할 수 없습니다.';
  }
});
