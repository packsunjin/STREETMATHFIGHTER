const params = new URLSearchParams(window.location.search);
const difficulty = params.get('difficulty') || '';

document.getElementById('pageTitle').textContent = difficulty
  ? `난이도 "${difficulty}" 문제 목록`
  : '전체 문제 목록';

async function loadProblems() {
  const qs = difficulty ? `?difficulty=${encodeURIComponent(difficulty)}` : '';
  const res = await fetch(`/api/problems${qs}`);
  const data = await res.json();
  const problems = data.problems || [];

  const grid = document.getElementById('problemGrid');
  const emptyState = document.getElementById('emptyState');

  if (problems.length === 0) {
    emptyState.style.display = 'block';
    return;
  }

  problems.forEach((problem) => {
    const card = document.createElement('div');
    card.className = 'problem-card';
    card.innerHTML = `
      <img src="${problem.imageUrl}" alt="${escapeHtml(problem.title)}" />
      <div class="info">
        <div class="title">${escapeHtml(problem.title)}</div>
        <span class="badge ${problem.difficulty}">${problem.difficulty}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      window.location.href = `solve.html?id=${problem.id}`;
    });
    grid.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadProblems();
