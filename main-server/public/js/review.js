// 오답 노트: 마지막 시도가 오답인 문제들만 모아 보여주고, 눌러서 바로 다시 풀 수 있게 함.
// (다시 풀어서 맞히면 서버 쪽 기준으로 목록에서 자동으로 빠진다)

const backBtn = document.getElementById('backBtn');
const wrongList = document.getElementById('wrongList');
const emptyState = document.getElementById('emptyState');
const reviewSubtitle = document.getElementById('reviewSubtitle');

backBtn.addEventListener('click', () => SMFAnim.navigate('index.html'));
SMFAnim.pressable(backBtn);

const ARROW_SVG =
  '<svg class="difficulty-bar-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function makeProblemButton(problem) {
  const btn = document.createElement('button');
  btn.className = 'difficulty-bar';
  btn.dataset.level = problem.difficulty;

  const main = document.createElement('span');
  main.className = 'difficulty-bar-main';

  const label = document.createElement('span');
  label.className = 'difficulty-bar-label';
  label.textContent = problem.title; // 관리자가 입력한 값이라 textContent로 넣음(XSS 방지)

  const caption = document.createElement('span');
  caption.className = 'difficulty-bar-caption';
  caption.textContent = problem.unit || (problem.questionType === 'objective' ? '객관식' : '주관식');

  main.append(label, caption);

  const meta = document.createElement('span');
  meta.className = 'difficulty-bar-meta';

  const when = document.createElement('span');
  when.className = 'difficulty-bar-time';
  when.textContent = formatDate(problem.lastTriedAt);
  meta.appendChild(when);
  meta.insertAdjacentHTML('beforeend', ARROW_SVG);

  btn.append(main, meta);
  btn.addEventListener('click', () => {
    SMFAnim.navigate(`solve.html?id=${problem.id}`);
  });
  return btn;
}

async function loadWrongProblems() {
  try {
    const data = await SMFStudent.fetchWrongProblems();
    const problems = data.problems || [];

    if (!problems.length) {
      emptyState.hidden = false;
      reviewSubtitle.textContent = '지금은 다시 풀 문제가 없어';
      return;
    }

    reviewSubtitle.textContent = `다시 풀어야 할 문제 ${problems.length}개`;
    problems.forEach((problem) => wrongList.appendChild(makeProblemButton(problem)));

    const buttons = wrongList.querySelectorAll('.difficulty-bar');
    SMFAnim.enterList(buttons, { each: 50 });
    SMFAnim.pressable(buttons);
    SMFAnim.hoverLift(buttons);
  } catch (err) {
    emptyState.hidden = false;
    emptyState.textContent = '기록을 불러오지 못했어. 잠시 후 다시 시도해줘.';
  }
}

loadWrongProblems();
