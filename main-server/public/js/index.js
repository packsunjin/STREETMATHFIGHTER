document.querySelectorAll('.difficulty-card').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    document.querySelectorAll('.difficulty-card').forEach((b) => (b.disabled = true));
    const difficulty = btn.dataset.difficulty;
    const nextId = await getNextProblemId(difficulty, null);
    if (nextId) {
      window.location.href = `solve.html?id=${nextId}`;
    } else {
      document.querySelectorAll('.difficulty-card').forEach((b) => (b.disabled = false));
      alert('아직 이 난이도에 등록된 문제가 없어요.');
    }
  });
});
