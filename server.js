// 배포용 통합 진입점: 메인 사이트(/)와 관리자 사이트(/admin)를
// 하나의 프로세스·하나의 포트에서 함께 서빙합니다.
//
// DB(Postgres)와 이미지(Cloudinary)가 모두 외부 서비스에 저장되므로
// 이 서버 자체는 상태를 갖지 않는(stateless) 배포가 가능합니다.
//
// 로컬 개발 시 두 서버를 별도 포트로 띄우고 싶다면 기존과 동일하게
// `npm run dev`(main-server, admin-server 개별 실행)를 사용하세요.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');

const mainApp = require('./main-server/server');
const adminApp = require('./admin-server/server');

const PORT = process.env.PORT || 3000;

const app = express();

app.use('/admin', adminApp);
app.use('/', mainApp);

const server = app.listen(PORT, () => {
  console.log(`[server] 스트릿매쓰파이터 실행 중: http://localhost:${PORT} (관리자: /admin)`);
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
