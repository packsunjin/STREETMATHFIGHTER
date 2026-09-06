// 서버는 하나다.
//
// 예전에는 학생용 사이트(main-server)와 관리자 사이트(admin-server)가 따로
// 있었는데, 학생용 화면이 없어지면서(행사는 강당 전자칠판 한 대에서 돌아가고
// 상품은 그 자리에서 손으로 준다) 앞쪽은 진행 화면으로 보내주는 껍데기만
// 남아 있었다. 그래서 합쳤다.
//
// 주소는 그대로다:
//   /admin/show.html  진행 화면(강당 전자칠판)
//   /admin            문제 등록
//   /                 진행 화면으로 보냄
//
// DB(Postgres)와 이미지(Cloudinary)가 모두 외부 서비스에 있어서 이 서버
// 자체는 상태를 갖지 않는(stateless) 배포가 가능하다.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');

const adminApp = require('./admin-server/server');

const PORT = process.env.PORT || 3000;

// 어디서도 못 잡은 예외/거부된 프라미스가 있으면 Node가 아무 설명 없이 그냥
// 죽어버리는데, 그러면 나중에 로그만 보고 원인을 알기 어려움. 무슨 일이
// 있었는지 남기고 나서(상태가 이미 망가졌을 수 있으니) 프로세스를 확실히 종료함
// -> 이후 Render 등의 플랫폼이 새 인스턴스로 재시작해줌.
process.on('uncaughtException', (err) => {
  console.error('[server] 처리되지 않은 예외로 종료합니다:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] 처리되지 않은 Promise 거부로 종료합니다:', reason);
  process.exit(1);
});

const app = express();

app.set('trust proxy', 1);

// 배포 플랫폼이 살아 있는지 확인하는 주소. 로그인 뒤에 두면 안 된다.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 전자칠판 주소창에 그냥 도메인만 쳐도 진행 화면이 뜨게 한다.
app.get('/', (req, res) => res.redirect('/admin/show.html'));

app.use('/admin', adminApp);

const server = app.listen(PORT, () => {
  console.log(`[server] 스트릿매쓰파이터 실행 중: http://localhost:${PORT}/admin/show.html`);
});

// Render 등에서 배포/재시작 시 새 인스턴스를 띄우기 전에 기존 인스턴스로 SIGTERM을
// 보내는데, 이걸 무시하면 처리 중이던 요청이 그대로 끊겨버림. 새 연결은 그만 받고
// 이미 들어온 요청은 마저 처리한 뒤에 종료하도록 함.
function shutdown(signal) {
  console.log(`[server] ${signal} 수신, 진행 중인 요청을 마저 처리하고 종료합니다...`);
  server.close(() => {
    console.log('[server] 정상 종료되었습니다.');
    process.exit(0);
  });
  // 어떤 이유로든 연결이 안 끝나서 close()가 콜백을 못 부르는 경우를 대비한 안전장치
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
