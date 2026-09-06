/**
 * 반 대항 집계.
 *
 * 진행자가 정답자 이름을 "2-3 김민수" 형태로 입력하므로, 앞부분을 반으로 본다.
 * 형식이 안 맞으면(그냥 "김민수") 어느 반인지 알 수 없으므로 집계에서 뺀다.
 *
 * 진행 화면과 학생용 공개 페이지 양쪽에서 같은 순위가 나와야 해서,
 * 계산은 서버에서 한 번만 하고 두 화면 모두 그 결과를 받아 쓴다.
 */

// "2-3", "10 - 4"처럼 학년-반 형태만 인정한다.
const CLASS_PATTERN = /^\s*(\d{1,2})\s*-\s*(\d{1,2})/;

function classOf(name) {
  const matched = CLASS_PATTERN.exec(name || '');
  return matched ? `${Number(matched[1])}-${Number(matched[2])}` : null;
}

/**
 * @param {Array<{studentName: string, correct: boolean}>} rounds
 * @returns {Array<{klass: string, wins: number, tries: number}>} 많이 맞힌 순
 */
function rankClasses(rounds) {
  const byClass = new Map();

  (rounds || []).forEach((round) => {
    const klass = classOf(round.studentName);
    if (!klass) return;

    const entry = byClass.get(klass) || { klass, wins: 0, tries: 0 };
    entry.tries += 1;
    if (round.correct) entry.wins += 1;
    byClass.set(klass, entry);
  });

  // 성공 수가 같으면 더 많이 도전한 반이 앞으로. 그것도 같으면 반 이름 순(결과 고정용).
  return [...byClass.values()].sort(
    (a, b) => b.wins - a.wins || b.tries - a.tries || a.klass.localeCompare(b.klass)
  );
}

module.exports = { classOf, rankClasses };
