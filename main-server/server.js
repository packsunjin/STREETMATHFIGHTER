require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { listShowRounds } = require('../shared/db');
const { rankClasses } = require('../shared/class-ranking');

const PORT = process.env.MAIN_PORT || 3000;

// 공개 사이트. 행사는 강당 전자칠판(/admin/show.html)에서 진행하고,
// 여기서는 학생들이 자기 폰으로 "오늘 누가 맞혔나"만 볼 수 있게 한다.
// 로그인이 없으므로 문제나 정답은 절대 내보내지 않는다.
const app = express();

// Render 등 리버스 프록시 뒤에서 실행되므로, req.ip가 프록시 IP가 아니라
// 실제 클라이언트 IP를 가리키게 함.
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false })); // CSP는 인라인 스크립트가 없어질 때까지 보류
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

// 오늘 행사 결과. 이름과 상품만 나가고, 문제 사진·정답·필기는 나가지 않는다.
const PUBLIC_WINDOW_HOURS = 12;

app.get('/api/today', async (req, res, next) => {
  try {
    const rounds = await listShowRounds({ sinceHours: PUBLIC_WINDOW_HOURS, limit: 200 });
    const winners = rounds.filter((row) => row.correct);

    res.json({
      total: rounds.length,
      wins: winners.length,
      // 반 대항 순위. 진행 화면과 같은 계산을 써서 두 화면의 순위가 어긋나지 않게 한다.
      classRanking: rankClasses(rounds.map((row) => ({
        studentName: row.student_name,
        correct: row.correct,
      }))),
      winners: winners.map((row) => ({
        name: row.student_name,
        prize: row.prize || null,
        problemTitle: row.problem_title || null,
        difficulty: row.difficulty || null,
        at: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[main-server] 공개 사이트 실행 중: http://localhost:${PORT}`);
  });

  function shutdown(signal) {
    console.log(`[main-server] ${signal} 수신, 진행 중인 요청을 마저 처리하고 종료합니다...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
