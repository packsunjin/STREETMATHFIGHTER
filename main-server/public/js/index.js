const difficultyButtons = document.querySelectorAll('.difficulty-bar');

// 난이도 버튼이 아래에서 위로 차례차례 올라오며 등장 + 누르는 촉감
SMFAnim.enterList(difficultyButtons, { delay: 80, each: 70 });
SMFAnim.pressable(difficultyButtons);
SMFAnim.hoverLift(difficultyButtons);

difficultyButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const difficulty = btn.dataset.difficulty;
    SMFAnim.navigate(`unit.html?difficulty=${encodeURIComponent(difficulty)}`);
  });
});
