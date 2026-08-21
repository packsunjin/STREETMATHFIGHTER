// 배포용 통합 진입점: 메인 사이트(/)와 관리자 사이트(/admin)를
// 하나의 프로세스·하나의 포트에서 함께 서빙합니다. (Render/Railway 등
// 단일 웹 서비스로 배포할 때, DB와 업로드 이미지가 저장된 디스크를
// 두 서버가 그대로 공유하도록 하기 위함입니다.)
//
// 로컬 개발 시 두 서버를 별도 포트로 띄우고 싶다면 기존과 동일하게
// `npm run dev`(main-server, admin-server 개별 실행)를 사용하세요.

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const path = require('path');
const express = require('express');

const { DATA_DIR } = require('./shared/db');
const mainApp = require('./main-server/server');
const adminApp = require('./admin-server/server');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const app = express();

// 업로드 이미지는 DB에 "/uploads/파일명"으로 저장되므로 사이트 루트에서 서빙합니다.
app.use('/uploads', express.static(UPLOAD_DIR));

app.use('/admin', adminApp);
app.use('/', mainApp);

app.listen(PORT, () => {
  console.log(`[server] 스트릿매쓰파이터 실행 중: http://localhost:${PORT} (관리자: /admin)`);
});
