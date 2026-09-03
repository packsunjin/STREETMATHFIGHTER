// 난이도별로 "이미 나온 문제는 전부 나올 때까지 다시 안 나오는" 셔플백(shuffle-bag) 큐.
// localStorage에 남은 문제 id 목록을 저장해두고, 다 떨어지면 전체를 다시 섞어서 채운다.

function smfShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function smfQueueKey(difficulty) {
  return `smf_queue_${difficulty}`;
}

async function getNextProblemId(difficulty, excludeId) {
  const key = smfQueueKey(difficulty);
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(key) || '[]');
  } catch (err) {
    queue = [];
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    const res = await fetch(`/api/problems?difficulty=${encodeURIComponent(difficulty)}`);
    const data = await res.json();
    const ids = (data.problems || []).map((p) => p.id);
    if (ids.length === 0) return null;

    queue = smfShuffle(ids);
    // 방금 푼 문제가 새 회차 맨 앞에 바로 다시 나오지 않도록 뒤로 보냄 (문제가 2개 이상일 때만)
    if (queue.length > 1 && queue[0] === excludeId) {
      queue.push(queue.shift());
    }
  }

  const nextId = queue.shift();
  try {
    localStorage.setItem(key, JSON.stringify(queue));
  } catch (err) {
    // localStorage 사용 불가(시크릿 모드 등)면 그냥 무시하고 매번 새로 섞음
  }
  return nextId;
}
