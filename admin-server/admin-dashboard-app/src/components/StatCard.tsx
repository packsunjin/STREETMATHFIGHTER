import { motion } from 'motion/react';

export function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4">
      <div className="text-xs font-semibold text-[var(--text-secondary)]">{label}</div>
      <motion.div
        className="mt-1 text-3xl font-black"
        style={{ color: color ?? 'var(--text)' }}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {value.toLocaleString('ko-KR')}
        <span className="ml-1 text-base font-bold text-[var(--text-secondary)]">문제</span>
      </motion.div>
    </div>
  );
}
