// 오늘의 결과 공개 페이지. 학생들이 자기 폰으로 여는 화면이라
// 문제나 정답은 전혀 다루지 않고, 서버가 준 이름/상품만 보여준다.

const winnersEl = document.getElementById('winners');
const emptyEl = document.getElementById('empty');
const failedEl = document.getElementById('failed');
const scoreEl = document.getElementById('score');

function makeRow(winner, index) {
  const li = document.createElement('li');
  li.className = 'winner';

  const rank = document.createElement('span');
  rank.className = 'winner-rank';
  rank.textContent = String(index + 1);

  const body = document.createElement('div');
  body.className = 'winner-body';

  // 이름과 문제 제목은 사람이 입력한 값이므로 textContent로만 넣는다(태그로 해석 금지)
  const name = document.createElement('span');
  name.className = 'winner-name';
  name.textContent = winner.name;

  const meta = document.createElement('span');
  meta.className = 'winner-meta';
  meta.textContent = [winner.difficulty && `난이도 ${winner.difficulty}`, winner.problemTitle]
    .filter(Boolean)
    .join(' · ');

  body.append(name, meta);
  li.append(rank, body);

  if (winner.prize) {
    const prize = document.createElement('span');
    prize.className = 'winner-prize';
    prize.textContent = winner.prize;
    li.appendChild(prize);
  }

  return li;
}

async function load() {
  failedEl.hidden = true;
  try {
    const res = await fetch('/api/today');
    if (!res.ok) throw new Error('실패');
    const data = await res.json();

    document.getElementById('statTotal').textContent = data.total;
    document.getElementById('statWins').textContent = data.wins;
    scoreEl.hidden = data.total === 0;

    winnersEl.textContent = '';
    data.winners.forEach((winner, index) => winnersEl.appendChild(makeRow(winner, index)));
    emptyEl.hidden = data.winners.length > 0;
  } catch (err) {
    failedEl.hidden = false;
    emptyEl.hidden = true;
  }
}

document.getElementById('refreshBtn').addEventListener('click', load);

// 행사 중에 열어두면 새 정답자가 저절로 올라오게 한다.
setInterval(load, 30_000);
load();
