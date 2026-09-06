import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { loadImage, renderWork, type AttemptDetail } from '../lib/work';

/**
 * 학생이 칠판에 쓴 풀이를 다시 그려 보여주는 창.
 * 문제가 삭제됐으면 사진이 없으므로 필기만 흰 배경 위에 그린다.
 */
export function WorkViewer({ round, onClose }: { round: AttemptDetail; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const draw = async () => {
      const canvas = canvasRef.current;
      if (!canvas || !round.work) return;

      let image: HTMLImageElement | null = null;
      if (round.imageUrl) {
        try {
          image = await loadImage(round.imageUrl);
        } catch {
          // 사진을 못 불러와도 필기는 보여준다
          image = null;
        }
      }
      if (cancelled) return;

      try {
        renderWork(canvas, image, round.work);
      } catch {
        setError('풀이를 그리지 못했어요.');
      }
    };

    draw();
    window.addEventListener('resize', draw);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', draw);
    };
  }, [round]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className="flex h-[88vh] w-full max-w-4xl flex-col rounded-2xl bg-[var(--card)] p-4"
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-black">{round.studentName}</div>
            <div className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {round.problemTitle || '삭제된 문제'} · {round.correct ? '성공' : '실패'}
              {round.prize ? ` · ${round.prize}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm font-bold"
          >
            닫기
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-white">
          {error ? (
            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
          ) : (
            <canvas ref={canvasRef} className="h-full w-full" />
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
