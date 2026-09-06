import { motion } from 'motion/react';
import { formatDateTime, formatDuration, type AttemptSummary } from '../lib/work';

/**
 * 한 학생이 칠판에 풀이를 남긴 라운드 목록.
 * 정답률 숫자만 봐서는 "왜 틀렸는지"를 알 수 없어서, 여기서 실제 필기로 들어간다.
 */
export function StudentRounds({
  name,
  rounds,
  loading,
  onOpen,
  onClose,
}: {
  name: string;
  rounds: AttemptSummary[];
  loading: boolean;
  onOpen: (round: AttemptSummary) => void;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold">{name} · 칠판에 쓴 풀이</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-[var(--border)] px-3 py-1 text-xs font-bold text-[var(--text-secondary)]"
        >
          접기
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--text-secondary)]">불러오는 중…</p>}

      {!loading && rounds.length === 0 && (
        <p className="text-sm text-[var(--text-secondary)]">
          남아 있는 풀이가 없어요. 칠판에 아무것도 안 쓰고 답만 말한 경우예요.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {rounds.map((round) => (
          <li key={round.id}>
            <button
              type="button"
              onClick={() => onOpen(round)}
              className="flex w-full items-center gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-left"
            >
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-black text-white"
                style={{ background: round.correct ? '#16a34a' : '#e0393e' }}
              >
                {round.correct ? '성공' : '실패'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {round.problemTitle || '삭제된 문제'}
                </span>
                <span className="block text-xs text-[var(--text-secondary)]">
                  {formatDateTime(round.createdAt)} · {formatDuration(round.durationMs)}
                  {round.prize ? ` · ${round.prize}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs font-bold text-[var(--text-secondary)]">보기 →</span>
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
