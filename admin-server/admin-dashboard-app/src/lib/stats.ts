// 선생님용 학생 성취도 통계 응답 타입 + 화면에서 공통으로 쓰는 표현 규칙

import type { Difficulty } from './theme';

export interface StudentStat {
  name: string;
  total: number;
  correct: number;
  prizes: number;
  accuracy: number;
  lastSolvedAt: string | null;
}

export interface HardestProblem {
  id: number | null;
  title: string;
  difficulty: Difficulty;
  total: number;
  correct: number;
  accuracy: number;
}

export interface DailyActivity {
  day: string;
  total: number;
  correct: number;
}

export interface StudentStatsResponse {
  students: StudentStat[];
  hardestProblems: HardestProblem[];
  dailyActivity: DailyActivity[];
}

// 정답률을 신호등처럼: 낮으면 빨강(도움이 필요), 높으면 초록
export function accuracyColor(accuracy: number): string {
  if (accuracy < 40) return '#e0393e';
  if (accuracy < 70) return '#d97706';
  return '#16a34a';
}

export function displayName(student: StudentStat): string {
  return student.name;
}

export function formatDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${Number(month)}/${Number(date)}`;
}

export function formatRelative(value: string | null): string {
  if (!value) return '-';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '-';
  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(value).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

/**
 * 서버는 "풀이가 있었던 날"만 돌려주기 때문에, 그대로 그리면 하루치만 있을 때
 * 막대 하나가 차트를 다 덮는다. 빈 날을 0으로 채워 항상 같은 길이의 달력처럼 보이게 함.
 */
export function fillMissingDays(data: DailyActivity[], days: number, today = new Date()): DailyActivity[] {
  const byDay = new Map(data.map((d) => [d.day, d]));
  const filled: DailyActivity[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    filled.push(byDay.get(key) ?? { day: key, total: 0, correct: 0 });
  }
  return filled;
}
