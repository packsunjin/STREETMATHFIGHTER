// 반 대항 집계. 진행 화면과 학생용 공개 페이지가 같은 순위를 보여야 해서
// 계산을 서버 한 곳에만 두고, 그 규칙을 여기서 고정한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { classOf, rankClasses } = require('../shared/class-ranking');

test('이름 앞부분에서 반을 뽑는다', () => {
  assert.equal(classOf('2-3 김민수'), '2-3');
  assert.equal(classOf('  1-1 박서준'), '1-1');
  assert.equal(classOf('10 - 4 최유리'), '10-4', '띄어쓰기가 섞여도 인식');
  assert.equal(classOf('2-03 이지훈'), '2-3', '앞의 0은 정리해서 같은 반으로 묶는다');
});

test('반을 알 수 없는 이름은 집계에서 빠진다', () => {
  assert.equal(classOf('김민수'), null);
  assert.equal(classOf(''), null);
  assert.equal(classOf(undefined), null);

  const ranking = rankClasses([
    { studentName: '김민수', correct: true },
    { studentName: '2-3 이지훈', correct: true },
  ]);
  assert.deepEqual(ranking, [{ klass: '2-3', wins: 1, tries: 1 }]);
});

test('성공 수가 많은 반이 앞에 온다', () => {
  const ranking = rankClasses([
    { studentName: '2-3 김민수', correct: true },
    { studentName: '2-3 이지훈', correct: true },
    { studentName: '1-1 박서준', correct: true },
    { studentName: '1-1 최유리', correct: false },
    { studentName: '3-2 정하늘', correct: false },
  ]);

  assert.deepEqual(ranking, [
    { klass: '2-3', wins: 2, tries: 2 },
    { klass: '1-1', wins: 1, tries: 2 },
    { klass: '3-2', wins: 0, tries: 1 },
  ]);
});

test('성공 수가 같으면 더 많이 도전한 반이 앞에 온다', () => {
  const ranking = rankClasses([
    { studentName: '1-1 가', correct: true },
    { studentName: '1-1 나', correct: false },
    { studentName: '1-1 다', correct: false },
    { studentName: '2-2 라', correct: true },
  ]);

  assert.deepEqual(ranking.map((r) => r.klass), ['1-1', '2-2']);
});

test('기록이 없으면 빈 순위', () => {
  assert.deepEqual(rankClasses([]), []);
  assert.deepEqual(rankClasses(undefined), []);
});
