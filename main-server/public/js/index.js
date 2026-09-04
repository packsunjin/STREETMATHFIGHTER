document.querySelectorAll('.difficulty-bar').forEach((btn) => {
  btn.addEventListener('click', () => {
    const difficulty = btn.dataset.difficulty;
    window.location.href = `unit.html?difficulty=${encodeURIComponent(difficulty)}`;
  });
});
