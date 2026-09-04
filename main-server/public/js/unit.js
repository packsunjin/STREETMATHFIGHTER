const params = new URLSearchParams(window.location.search);
const difficulty = params.get('difficulty');

const unitPageTitle = document.getElementById('unitPageTitle');
const unitList = document.getElementById('unitList');
const backBtn = document.getElementById('backBtn');

backBtn.addEventListener('click', () => {
  window.location.href = 'index.html';
});

function makeUnitButton(label, caption, unitValue) {
  const btn = document.createElement('button');
  btn.className = 'difficulty-bar';
  btn.innerHTML = `
    <span class="difficulty-bar-label">${label}</span>
    <span class="difficulty-bar-caption">${caption}</span>
  `;
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    unitList.querySelectorAll('.difficulty-bar').forEach((b) => (b.disabled = true));
    const nextId = await getNextProblemId(difficulty, null, unitValue || null);
    if (nextId) {
      window.location.href = `solve.html?id=${nextId}`;
    } else {
      unitList.querySelectorAll('.difficulty-bar').forEach((b) => (b.disabled = false));
      alert('아직 이 난이도/단원에 등록된 문제가 없어요.');
    }
  });
  return btn;
}

async function loadUnits() {
  if (!difficulty) {
    window.location.href = 'index.html';
    return;
  }
  unitPageTitle.textContent = `단원 선택 (${difficulty})`;

  unitList.appendChild(makeUnitButton('전체', '모든 단원에서 출제', ''));

  try {
    const res = await fetch(`/api/units?difficulty=${encodeURIComponent(difficulty)}`);
    const data = await res.json();
    (data.units || []).forEach((unit) => {
      unitList.appendChild(makeUnitButton(unit, '', unit));
    });
  } catch (err) {
    // 단원 목록을 못 불러와도 "전체"로는 계속 진행 가능
  }
}

loadUnits();
