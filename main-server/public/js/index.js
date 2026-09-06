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

// ---- 내 기록 ----

const greeting = document.getElementById('greeting');
const nameBtn = document.getElementById('nameBtn');
const myStats = document.getElementById('myStats');
const statSolved = document.getElementById('statSolved');
const statAccuracy = document.getElementById('statAccuracy');
const statStreak = document.getElementById('statStreak');
const reviewLink = document.getElementById('reviewLink');
const reviewLinkText = document.getElementById('reviewLinkText');

function renderGreeting() {
  const name = SMFStudent.getName();
  greeting.textContent = name ? `${name}, 오늘도 한 판 붙어볼까?` : '난이도를 고르면 바로 한 판 시작';
  nameBtn.textContent = name ? '이름 바꾸기' : '이름 설정';
}

nameBtn.addEventListener('click', () => {
  const current = SMFStudent.getName();
  const input = window.prompt('이름을 입력해줘 (선생님 화면에 표시돼)', current);
  if (input === null) return;
  SMFStudent.setName(input);
  renderGreeting();
});

// 숫자가 0에서 목표값까지 굴러 올라가는 연출
function countUp(el, value, suffix = '') {
  if (!SMFAnim.enabled) {
    el.textContent = `${value}${suffix}`;
    return;
  }
  const state = { n: 0 };
  anime.animate(state, {
    n: value,
    duration: 900,
    ease: 'out(3)',
    onUpdate: () => {
      el.textContent = `${Math.round(state.n)}${suffix}`;
    },
  });
}

async function loadMyStats() {
  try {
    const summary = await SMFStudent.fetchSummary();
    if (!summary.total) return; // 아직 푼 적 없으면 기록 영역을 아예 안 보여줌

    myStats.hidden = false;
    const accuracy = Math.round((summary.correct / summary.total) * 100);
    countUp(statSolved, summary.total);
    countUp(statAccuracy, accuracy, '%');
    countUp(statStreak, summary.streak);

    SMFAnim.enterList([myStats], { delay: 40, y: 14 });

    const wrong = await SMFStudent.fetchWrongProblems();
    const count = (wrong.problems || []).length;
    if (count > 0) {
      reviewLinkText.textContent = `오답 노트 ${count}문제 다시 풀기`;
      reviewLink.hidden = false;
      SMFAnim.pressable([reviewLink]);
    }
  } catch (err) {
    // 기록을 못 불러와도 문제 풀이 자체는 아무 문제 없어야 하므로 조용히 넘어감
  }
}

renderGreeting();
loadMyStats();
