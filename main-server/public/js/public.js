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

// 반 순위는 서버가 계산해서 준다(강당 진행 화면과 같은 결과가 나오도록).
function renderClassRanking(ranking) {
  const box = document.getElementById('classRace');
  const list = document.getElementById('classList');
  list.textContent = '';

  // 반이 하나뿐이면 "대항"이 아니라 굳이 안 보여준다
  box.hidden = !ranking || ranking.length < 2;
  if (box.hidden) return;

  const top = Math.max(...ranking.map((r) => r.wins), 1);

  ranking.slice(0, 8).forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'class-item' + (index === 0 ? ' leading' : '');

    const name = document.createElement('span');
    name.className = 'class-name';
    name.textContent = `${entry.klass}반`;

    const bar = document.createElement('span');
    bar.className = 'class-bar';
    const fill = document.createElement('span');
    fill.className = 'class-bar-fill';
    fill.style.width = `${(entry.wins / top) * 100}%`;
    bar.appendChild(fill);

    const wins = document.createElement('span');
    wins.className = 'class-wins';
    wins.textContent = `${entry.wins}승`;

    li.append(name, bar, wins);
    list.appendChild(li);
  });
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

    renderClassRanking(data.classRanking);

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
