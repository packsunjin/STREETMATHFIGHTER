// 난이도(+단원)별로 "이미 나온 문제는 전부 나올 때까지 다시 안 나오는" 셔플백(shuffle-bag) 큐.
// localStorage에 남은 문제 id 목록을 저장해두고, 다 떨어지면 전체를 다시 섞어서 채운다.

function smfShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function smfQueueKey(difficulty, unit) {
  return `smf_queue_${difficulty}_${unit || 'all'}`;
}

async function smfFetchNextFromQueue(difficulty, unit, excludeId) {
  const key = smfQueueKey(difficulty, unit);
  let queue = [];
  try {
    queue = JSON.parse(localStorage.getItem(key) || '[]');
  } catch (err) {
    queue = [];
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    let url = `/api/problems?difficulty=${encodeURIComponent(difficulty)}`;
    if (unit) url += `&unit=${encodeURIComponent(unit)}`;
    const res = await fetch(url);
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

// 단원을 지정했는데 그 단원 안에 다른 문제가 없어서 같은 문제만 계속 나오면(막힌 것처럼 보임),
// 해당 난이도 전체 범위로 넓혀서 진짜 다음 문제를 찾는다.
async function getNextProblemId(difficulty, excludeId, unit) {
  const primary = await smfFetchNextFromQueue(difficulty, unit, excludeId);
  if (unit && excludeId != null && primary === excludeId) {
    const fallback = await smfFetchNextFromQueue(difficulty, null, excludeId);
    if (fallback !== null) return fallback;
  }
  return primary;
}
