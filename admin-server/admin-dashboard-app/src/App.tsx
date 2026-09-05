import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { SimpleBarChart, type DifficultyCount } from './components/SimpleBarChart';
import { StackedBarChart, StackedBarLegend, type UnitCount } from './components/StackedBarChart';
import { StatCard } from './components/StatCard';

interface StatsResponse {
  byDifficulty: DifficultyCount[];
  byUnit: UnitCount[];
  total: number;
}

// admin-server는 단독으로도, 통합 서버의 /admin 아래에서도 실행될 수 있어서
// 절대 경로(/api/me 등)를 쓰면 /admin 마운트 시 깨짐. 이 페이지는 항상
// ".../stats/" 형태(끝에 슬래시)로 열리므로, admin 루트 기준 상대 경로는 "../"로 계산한다.
function useAuthGuard() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    fetch('../api/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.authenticated) {
          window.location.href = '../index.html';
          return;
        }
        setChecked(true);
      })
      .catch(() => {
        window.location.href = '../index.html';
      });
  }, []);

  return checked;
}

function App() {
  const authChecked = useAuthGuard();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    fetch('../api/stats/problem-counts', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('통계를 불러오지 못했습니다.');
        return res.json();
      })
      .then((data: StatsResponse) => setStats(data))
      .catch((err) => setError(err.message));
  }, [authChecked]);

  if (!authChecked) return null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black">문제 통계</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            등록된 문제의 난이도/단원별 분포를 보여줘요.
          </p>
        </div>
        <a
          href="../dashboard.html"
          className="rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-bold text-[var(--text)] no-underline"
        >
          ← 문제 관리로
        </a>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--red)] bg-[var(--red-light)] px-4 py-3 text-sm font-semibold text-[var(--red)]">
          {error}
        </div>
      )}

      {stats && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="전체 문제 수" value={stats.total} />
            {stats.byDifficulty.map((d) => (
              <StatCard key={d.difficulty} label={`난이도 ${d.difficulty}`} value={d.count} />
            ))}
          </div>

          <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="mb-4 text-sm font-bold">난이도별 문제 수</h2>
            <SimpleBarChart data={stats.byDifficulty} />
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-bold">단원별 문제 수</h2>
              <StackedBarLegend />
            </div>
            {stats.byUnit.length > 0 ? (
              <StackedBarChart data={stats.byUnit} />
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">아직 단원이 등록된 문제가 없어요.</p>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}

export default App;
