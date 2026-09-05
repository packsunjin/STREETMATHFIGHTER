const params = new URLSearchParams(window.location.search);
const difficulty = params.get('difficulty') || '';

const backBtn = document.getElementById('backBtn');
backBtn.addEventListener('click', () => SMFAnim.navigate('index.html'));
SMFAnim.pressable(backBtn);

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
      <span class="badge badge-corner">${problem.difficulty}</span>
      <img src="${problem.imageUrl}" alt="${escapeHtml(problem.title)}" />
      <div class="info">
        <div class="title">${escapeHtml(problem.title)}</div>
        <span class="badge type">${problem.questionType === 'objective' ? '객관식' : '주관식'}</span>
      </div>
    `;
    card.addEventListener('click', () => {
      SMFAnim.navigate(`solve.html?id=${problem.id}`);
    });
    grid.appendChild(card);
  });

  // 카드가 순서대로 톡톡 나타나게
  const cards = grid.querySelectorAll('.problem-card');
  SMFAnim.enterList(cards, { each: 40, y: 18 });
  SMFAnim.pressable(cards, { scale: 0.97 });
  SMFAnim.hoverLift(cards);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

loadProblems();
