const params = new URLSearchParams(window.location.search);
const difficulty = params.get('difficulty');

const unitPageTitle = document.getElementById('unitPageTitle');
const unitList = document.getElementById('unitList');
const backBtn = document.getElementById('backBtn');

backBtn.addEventListener('click', () => {
  SMFAnim.navigate('index.html');
});
SMFAnim.pressable(backBtn);

const ARROW_SVG =
  '<svg class="difficulty-bar-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

function makeUnitButton(label, caption, unitValue) {
  const btn = document.createElement('button');
  btn.className = 'difficulty-bar';
  btn.dataset.level = difficulty; // 왼쪽 색 띠를 고른 난이도 색으로

  const main = document.createElement('span');
  main.className = 'difficulty-bar-main';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'difficulty-bar-label';
  labelSpan.textContent = label; // unit은 관리자가 자유 입력하는 값이라 innerHTML에 그대로 넣으면 안 됨(XSS)

  const captionSpan = document.createElement('span');
  captionSpan.className = 'difficulty-bar-caption';
  captionSpan.textContent = caption;

  main.append(labelSpan, captionSpan);

  // 화살표는 우리가 만든 고정 마크업이라 innerHTML을 써도 안전함
  const meta = document.createElement('span');
  meta.className = 'difficulty-bar-meta';
  meta.innerHTML = ARROW_SVG;

  btn.append(main, meta);
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    unitList.querySelectorAll('.difficulty-bar').forEach((b) => (b.disabled = true));
    const nextId = await getNextProblemId(difficulty, null, unitValue || null);
    if (nextId) {
      SMFAnim.navigate(`solve.html?id=${nextId}`);
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
  const heroBadge = document.getElementById('heroLevelBadge');
  heroBadge.textContent = difficulty;
  heroBadge.dataset.level = difficulty;

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

  // 목록이 다 만들어진 다음에 한꺼번에 차례로 등장시킴
  const buttons = unitList.querySelectorAll('.difficulty-bar');
  SMFAnim.enterList(buttons, { each: 55 });
  SMFAnim.pressable(buttons);
  SMFAnim.hoverLift(buttons);
}

loadUnits();
