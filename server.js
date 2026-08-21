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

app.listen(PORT, () => {
  console.log(`[server] 스트릿매쓰파이터 실행 중: http://localhost:${PORT} (관리자: /admin)`);
});
