import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { accuracyColor, displayName, formatRelative, type StudentStat } from '../lib/stats';

type SortKey = 'recent' | 'accuracy' | 'total';

const SORT_LABEL: Record<SortKey, string> = {
  recent: '최근 활동순',
  accuracy: '성공률 낮은순',
  total: '많이 도전한 순',
};

// 선생님이 실제로 궁금한 건 "누가 자주 나오는데 못 맞히나"라서, 정렬 기본값은
// 최근 활동순으로 두되 성공률 낮은순으로 한 번에 바꿀 수 있게 함.
export function StudentTable({ students }: { students: StudentStat[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const sorted = useMemo(() => {
    const copy = [...students];
    if (sortKey === 'accuracy') copy.sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
    else if (sortKey === 'total') copy.sort((a, b) => b.total - a.total);
    return copy;
  }, [students, sortKey]);

  if (!students.length) {
    return <p className="text-sm text-[var(--text-secondary)]">아직 도전한 학생이 없어요.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSortKey(key)}
            className={
              'rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ' +
              (sortKey === key
                ? 'border-[var(--text)] bg-[var(--text)] text-white'
                : 'border-[var(--border)] bg-[var(--card)] text-[var(--text-secondary)]')
            }
          >
            {SORT_LABEL[key]}
          </button>
        ))}
      </div>

      <ul className="flex flex-col gap-2">
        {sorted.map((student, index) => (
          <motion.li
            key={student.name}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
            className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{displayName(student)}</div>
              <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {student.correct}/{student.total}번 성공
                {student.prizes > 0 && ` · 상품 ${student.prizes}개`} ·{' '}
                {formatRelative(student.lastSolvedAt)}
              </div>
            </div>

            <div className="hidden h-2 w-32 overflow-hidden rounded-full bg-[var(--border)] sm:block">
              <motion.div
                className="h-full rounded-full"
                style={{ background: accuracyColor(student.accuracy) }}
                initial={{ width: 0 }}
                animate={{ width: `${student.accuracy}%` }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
            </div>

            <div
              className="w-14 text-right text-lg font-black tabular-nums"
              style={{ color: accuracyColor(student.accuracy) }}
            >
              {student.accuracy}%
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
