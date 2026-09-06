import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { SimpleBarChart, type DifficultyCount } from './components/SimpleBarChart';
import { StackedBarChart, StackedBarLegend, type UnitCount } from './components/StackedBarChart';
import { StatCard } from './components/StatCard';
import { ActivityChart } from './components/ActivityChart';
import { StudentTable } from './components/StudentTable';
import { HardestProblems } from './components/HardestProblems';
import { StudentRounds } from './components/StudentRounds';
import { WorkViewer } from './components/WorkViewer';
import { accuracyColor, fillMissingDays, type StudentStatsResponse } from './lib/stats';
import type { AttemptDetail, AttemptSummary } from './lib/work';

interface ProblemStats {
  byDifficulty: DifficultyCount[];
  byUnit: UnitCount[];
  total: number;
}

type Tab = 'problems' | 'students';

const ACTIVITY_DAYS = 14; // 서버의 listDailyActivity(14)와 맞춰야 함

const TAB_LABEL: Record<Tab, string> = {
  problems: '문제 통계',
  students: '행사 기록',
};

const TAB_DESCRIPTION: Record<Tab, string> = {
  problems: '등록된 문제의 난이도/단원별 분포를 보여줘요.',
  students: '강당 행사에서 누가 얼마나 맞혔는지 보여줘요.',
};

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

function Card({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold">{title}</h2>
        {extra}
      </div>
      {children}
    </div>
  );
}

function ProblemsTab({ stats }: { stats: ProblemStats }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="전체 문제 수" value={stats.total} />
        {stats.byDifficulty.map((d) => (
          <StatCard key={d.difficulty} label={`난이도 ${d.difficulty}`} value={d.count} />
        ))}
      </div>

      <Card title="난이도별 문제 수">
        <SimpleBarChart data={stats.byDifficulty} />
      </Card>

      <Card title="단원별 문제 수" extra={<StackedBarLegend />}>
        {stats.byUnit.length > 0 ? (
          <StackedBarChart data={stats.byUnit} />
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">아직 단원이 등록된 문제가 없어요.</p>
        )}
      </Card>
    </div>
  );
}

function StudentsTab({ stats }: { stats: StudentStatsResponse }) {
  // 학생을 누르면 그 학생이 칠판에 쓴 풀이를 불러온다(목록에는 필기 본문을 안 싣는다)
  const [selected, setSelected] = useState<string | null>(null);
  const [rounds, setRounds] = useState<AttemptSummary[]>([]);
  const [loadingRounds, setLoadingRounds] = useState(false);
  const [viewing, setViewing] = useState<AttemptDetail | null>(null);

  useEffect(() => {
    if (!selected) return;
    setLoadingRounds(true);
    setRounds([]);
    fetch(`../api/rounds?studentName=${encodeURIComponent(selected)}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setRounds(data.rounds || []))
      .catch(() => setRounds([]))
      .finally(() => setLoadingRounds(false));
  }, [selected]);

  const openRound = (round: AttemptSummary) => {
    fetch(`../api/rounds/${round.id}`, { credentials: 'include' })
      .then((res) => res.json())
      .then((detail: AttemptDetail) => {
        if (detail.work) setViewing(detail);
      })
      .catch(() => {});
  };

  const attempts = stats.students.reduce((sum, s) => sum + s.total, 0);
  const correct = stats.students.reduce((sum, s) => sum + s.correct, 0);
  const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
  const activity = fillMissingDays(stats.dailyActivity, ACTIVITY_DAYS);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="도전한 학생" value={stats.students.length} suffix="명" />
        <StatCard label="전체 도전" value={attempts} suffix="번" />
        <StatCard label="성공" value={correct} suffix="번" />
        <StatCard label="평균 성공률" value={accuracy} suffix="%" color={accuracyColor(accuracy)} />
      </div>

      <Card title="최근 14일 행사 기록" extra={<ActivityLegend />}>
        {stats.dailyActivity.length > 0 ? (
          <ActivityChart data={activity} />
        ) : (
          <p className="text-sm text-[var(--text-secondary)]">최근 2주 동안 행사 기록이 없어요.</p>
        )}
      </Card>

      <Card title="학생별 성공률">
        <StudentTable
          students={stats.students}
          selected={selected}
          onSelect={(name) => setSelected((prev) => (prev === name ? null : name))}
          renderDetail={(name) => (
            <StudentRounds
              name={name}
              rounds={rounds}
              loading={loadingRounds}
              onOpen={openRound}
              onClose={() => setSelected(null)}
            />
          )}
        />
      </Card>

      <Card title="아무도 못 맞힌 문제">
        <HardestProblems problems={stats.hardestProblems} />
      </Card>

      <AnimatePresence>
        {viewing && <WorkViewer round={viewing} onClose={() => setViewing(null)} />}
      </AnimatePresence>
    </div>
  );
}

function ActivityLegend() {
  return (
    <div className="flex items-center gap-3 text-xs font-semibold text-[var(--text-secondary)]">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#16a34a' }} />
        성공
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--border)' }} />
        전체
      </span>
    </div>
  );
}

function App() {
  const authChecked = useAuthGuard();
  const [tab, setTab] = useState<Tab>('problems');
  const [problemStats, setProblemStats] = useState<ProblemStats | null>(null);
  const [studentStats, setStudentStats] = useState<StudentStatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authChecked) return;
    // 두 탭 모두 가벼운 집계라 처음에 한 번에 받아두고, 탭 전환은 즉시 되게 함.
    Promise.all([
      fetch('../api/stats/problem-counts', { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error('문제 통계를 불러오지 못했습니다.');
        return res.json() as Promise<ProblemStats>;
      }),
      fetch('../api/stats/students', { credentials: 'include' }).then((res) => {
        if (!res.ok) throw new Error('학생 통계를 불러오지 못했습니다.');
        return res.json() as Promise<StudentStatsResponse>;
      }),
    ])
      .then(([problems, students]) => {
        setProblemStats(problems);
        setStudentStats(students);
      })
      .catch((err: Error) => setError(err.message));
  }, [authChecked]);

  if (!authChecked) return null;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black">통계</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{TAB_DESCRIPTION[tab]}</p>
        </div>
        <a
          href="../dashboard.html"
          className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--card)] px-4 py-2 text-sm font-bold text-[var(--text)] no-underline"
        >
          ← 문제 관리로
        </a>
      </div>

      <div className="mb-6 flex gap-2">
        {(Object.keys(TAB_LABEL) as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="relative rounded-full px-4 py-2 text-sm font-bold text-[var(--text)]"
          >
            {tab === key && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 rounded-full bg-[var(--text)]"
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              />
            )}
            <span className={'relative ' + (tab === key ? 'text-white' : 'text-[var(--text-secondary)]')}>
              {TAB_LABEL[key]}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--red)] bg-[var(--red-light)] px-4 py-3 text-sm font-semibold text-[var(--red)]">
          {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        {tab === 'problems' && problemStats && (
          <motion.div
            key="problems"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <ProblemsTab stats={problemStats} />
          </motion.div>
        )}
        {tab === 'students' && studentStats && (
          <motion.div
            key="students"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <StudentsTab stats={studentStats} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
