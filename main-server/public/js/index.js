const unitSelect = document.getElementById('unitSelect');

async function loadUnits() {
  try {
    const res = await fetch('/api/units');
    const data = await res.json();
    (data.units || []).forEach((unit) => {
      const opt = document.createElement('option');
      opt.value = unit;
      opt.textContent = unit;
      unitSelect.appendChild(opt);
    });
  } catch (err) {
    // 단원 목록을 못 불러와도 "전체 단원"으로는 계속 진행 가능
  }
}

document.querySelectorAll('.difficulty-bar').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    document.querySelectorAll('.difficulty-bar').forEach((b) => (b.disabled = true));
    const difficulty = btn.dataset.difficulty;
    const unit = unitSelect.value || null;
    const nextId = await getNextProblemId(difficulty, null, unit);
    if (nextId) {
      window.location.href = `solve.html?id=${nextId}`;
    } else {
      document.querySelectorAll('.difficulty-bar').forEach((b) => (b.disabled = false));
      alert('아직 이 난이도/단원에 등록된 문제가 없어요.');
    }
  });
});

loadUnits();
