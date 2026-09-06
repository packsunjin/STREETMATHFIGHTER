require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const PORT = process.env.MAIN_PORT || 3000;

// 이 앱에 학생용 화면은 없다. 행사는 강당 전자칠판(/admin/show.html) 한 대에서
// 진행자가 돌리고, 상품은 그 자리에서 손으로 준다.
// 그래서 루트는 진행 화면으로 보내주는 역할만 한다.
const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`[main-server] 실행 중: http://localhost:${PORT}`);
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
