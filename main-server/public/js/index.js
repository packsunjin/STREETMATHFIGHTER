document.querySelectorAll('.difficulty-card').forEach((btn) => {
  btn.addEventListener('click', () => {
    const difficulty = btn.dataset.difficulty;
    window.location.href = `list.html?difficulty=${encodeURIComponent(difficulty)}`;
  });
});
