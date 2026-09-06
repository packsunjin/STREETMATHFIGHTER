import { motion } from 'motion/react';
import { accuracyColor, type HardestProblem } from '../lib/stats';
import { DIFFICULTY_COLOR } from '../lib/theme';

// 정답률이 가장 낮은 문제부터. 수업에서 다시 짚어줘야 할 문제를 찾는 용도.
export function HardestProblems({ problems }: { problems: HardestProblem[] }) {
  if (!problems.length) {
    return <p className="text-sm text-[var(--text-secondary)]">아직 행사 기록이 쌓이지 않았어요.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {problems.map((problem, index) => (
        <motion.li
          key={problem.title}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.3) }}
          className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
        >
          <span
            className="shrink-0 rounded-md px-2 py-0.5 text-xs font-black text-white"
            style={{ background: DIFFICULTY_COLOR[problem.difficulty] ?? 'var(--text-secondary)' }}
          >
            {problem.difficulty}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{problem.title}</div>
            <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
{problem.total}번 도전 · {problem.correct}번 성공
            </div>
          </div>
          <div
            className="shrink-0 text-lg font-black tabular-nums"
            style={{ color: accuracyColor(problem.accuracy) }}
          >
            {problem.accuracy}%
          </div>
        </motion.li>
      ))}
    </ul>
  );
}
