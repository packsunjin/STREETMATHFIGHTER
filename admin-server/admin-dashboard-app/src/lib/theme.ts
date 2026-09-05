export const DIFFICULTIES = ['상', '중', '하'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const DIFFICULTY_COLOR: Record<Difficulty, string> = {
  상: '#e0393e', // red — 어려운 난이도
  중: '#d97706', // orange — 중간 난이도
  하: '#16a34a', // green — 쉬운 난이도
};

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  상: '상 (어려움)',
  중: '중 (보통)',
  하: '하 (쉬움)',
};
