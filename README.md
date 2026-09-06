# 스트릿 매쓰 파이터

점심시간 강당에서 진행하는 **라이브 수학 대결** 운영 도구입니다.
문제를 큰 화면에 띄우고, 손을 든 학생이 앞에 나와 전자칠판에 직접 풀고,
맞히면 그 자리에서 상품을 주는 방식(미미미누 길거리 수학 챌린지 형식)입니다.

세 개의 화면으로 이루어져 있습니다.

| 화면 | 주소 | 쓰는 사람 / 기기 |
| --- | --- | --- |
| **진행 화면** | `/admin/show.html` | 진행자 + 학생 / 강당 **전자칠판** |
| **문제 관리** | `/admin` | 진행자 / 아무 PC |
| **오늘의 결과** | `/` | 학생 / 자기 폰 (로그인 없음) |

### 진행 화면이 하는 일

대기 → 난이도 선택 → 문제 예고 → **3·2·1 카운트다운** → 풀이 →
정답 공개 → 맞혔다/틀렸다 → 이름·상품 입력 → 축하 연출 → 다음 문제.

페이지 이동 없이 한 화면에서 상태만 바뀌기 때문에 진행 중에 화면이 끊기지 않습니다.

- 전자칠판 크기에 맞춰 글자·버튼이 화면 비례로 커집니다(65~86인치 어디서든 동일한 비율).
- 학생이 사진 위에도, 옆 흰 여백에도 손이나 펜으로 바로 풉니다.
  펜을 쓴 직후에는 터치를 무시해서 **손바닥이 닿아도 획이 안 그어집니다**.
- 난이도별 제한시간(하 1:30 / 중 3:00 / 상 5:00), 진행 중 +30초·일시정지.
- 마지막 10초 초읽기, 시간 종료 부저, 정답 팡파레, 축하 색종이.
- 같은 회차(최근 12시간)에 이미 나온 문제는 다시 뽑히지 않습니다.
- 정답자 이름과 상품이 기록되고, 오늘의 명예의 전당에 쌓입니다.

기록은 문제를 나중에 삭제해도 남습니다. 누가 무슨 상을 받았는지는 사실 기록이라
문제 삭제로 사라지면 안 되기 때문입니다.

### 구성

- **admin-server**: 로그인, 문제 등록/수정/삭제(사진 업로드), 진행 화면, 행사 통계 대시보드
- **main-server**: 로그인 없이 열리는 공개 결과 페이지. 정답·문제 사진·필기는 절대 내보내지 않습니다.

두 사이트는 동일한 **Postgres DB**와 **Cloudinary 이미지 저장소**를 공유합니다(둘 다 무료 플랜, 신용카드 불필요).
서버는 로컬 디스크에 아무 상태도 저장하지 않으므로(stateless), 재시작/슬립 후에도 데이터가 사라지지 않습니다.

로컬 개발에서는 두 개의 독립된 Express 서버(포트 분리)로 실행하고,
배포 시에는 `server.js`가 두 사이트를 하나의 서비스(`/`, `/admin`)로 묶어 실행합니다.

## 준비물 (둘 다 무료, 신용카드 불필요)

1. **Postgres** — [neon.tech](https://neon.tech) 가입 → 프로젝트 생성 → connection string 복사 (`postgresql://...`)
2. **이미지 저장소** — [cloudinary.com](https://cloudinary.com) 가입 → Dashboard에서 **API Environment variable** 값 복사 (`cloudinary://...`)

## 시작하기

```bash
npm install
cp .env.example .env
# .env에 DATABASE_URL, CLOUDINARY_URL을 위에서 복사한 값으로 채워넣기
npm run dev             # main-server(3000) + admin-server(4000) 동시 실행
```

개별 실행:

```bash
npm run dev:main    # http://localhost:3000
npm run dev:admin   # http://localhost:4000
```

로컬에서 두 서버를 별도 포트로 운영 실행: `npm run start:main`, `npm run start:admin`

## 환경변수 (`.env`)

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `MAIN_PORT` | (로컬 개발) 공개 사이트 포트 | 3000 |
| `ADMIN_PORT` | (로컬 개발) 관리자 서버 포트 | 4000 |
| `PORT` | (배포) 통합 서버가 사용할 단일 포트 | 3000, 대부분 호스팅에서 자동 주입 |
| `ADMIN_USERNAME` | 관리자 로그인 아이디 | admin |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 | changeme123 |
| `SESSION_SECRET` | 세션 쿠키 서명 키 | (배포 전 반드시 변경) |
| `DATABASE_URL` | Neon 등 Postgres 연결 문자열 | 필수 |
| `CLOUDINARY_URL` | Cloudinary 연결 문자열 | 필수 |
| `NODE_ENV` | `production`이면 세션 쿠키에 Secure 플래그가 붙고 요청 로그 형식이 바뀜 | development |

## GitHub 리포로 웹사이트 배포하기 (Render, 완전 무료)

GitHub Pages는 정적 파일만 서빙하므로 로그인·DB·이미지 업로드가 필요한 이 서비스는 열 수 없습니다. 대신 리포에 포함된 `render.yaml`로 [Render](https://render.com) 무료 플랜에 그대로 배포할 수 있습니다 — DB와 이미지가 모두 외부(Neon, Cloudinary)에 있어서 Render의 유료 전용 기능인 영구 디스크가 필요 없습니다.

1. Neon, Cloudinary에 가입해서 `DATABASE_URL`, `CLOUDINARY_URL` 값을 미리 받아둡니다.
2. Render에서 GitHub 저장소 연결 → **New > Blueprint** 선택 → 이 리포 선택 (`render.yaml` 자동 인식)
3. 배포 화면에서 `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DATABASE_URL`, `CLOUDINARY_URL` 값을 입력
4. 배포가 끝나면 하나의 URL로 접속합니다.
   - `https://<서비스주소>/admin/show.html` → **강당 전자칠판에서 열 진행 화면**
   - `https://<서비스주소>/admin` → 문제 등록·통계
   - `https://<서비스주소>/` → 학생들이 폰으로 보는 오늘의 결과

Render 무료 플랜은 15분간 요청이 없으면 서버가 슬립되고, 다음 요청 때 몇 초간 깨어나는 지연이 있습니다. 하지만 데이터는 Postgres/Cloudinary에 있으므로 **슬립되거나 재배포돼도 등록한 문제와 이미지는 그대로 유지**됩니다.

Railway, Fly.io 등 다른 Node.js 호스팅도 원리는 같습니다: 빌드 `npm install`, 시작 `npm start`, 환경변수로 `DATABASE_URL`/`CLOUDINARY_URL`만 넣어주면 됩니다.

## 행사 진행 순서

1. **문제 등록 (미리)** — `/admin`에 로그인해서 문제 제목, 난이도(상/중/하), 단원,
   문제 유형(객관식/주관식), **정답**, 문제 사진을 등록합니다.
   정답이 없는 문제는 진행 화면에 나오지 않습니다(그 자리에서 정답을 공개해야 하므로).
2. **강당에서** — 전자칠판 브라우저로 `/admin/show.html`을 엽니다.
   처음 한 번 로그인하면 그 뒤로는 바로 열립니다.
3. **도전 시작** → 난이도를 고르면 그 난이도에서 아직 안 쓴 문제가 무작위로 뽑힙니다.
4. **시작!** → 3·2·1 카운트다운 후 문제 사진과 타이머가 뜹니다.
   손 든 학생이 앞에 나와 칠판에 직접 풉니다(사진 위, 옆 흰 공간 아무 데나).
   진행자는 필요하면 **+30초**나 **일시정지**를 누릅니다.
5. **정답 공개** → 정답이 크게 뜹니다. 진행자가 **맞혔다 / 틀렸다**를 누릅니다.
6. 맞혔으면 **이름과 상품**을 입력합니다(상품은 전에 쓴 게 자동완성으로 뜹니다).
   등록하면 축하 연출이 나오고 명예의 전당에 올라갑니다.
   틀렸어도 이름만 넣어두면 도전 기록으로 남고, 그냥 **건너뛰기**도 됩니다.
7. 학생들은 자기 폰으로 `/`에 들어가 오늘의 정답자와 상품을 볼 수 있습니다.

진행 중 실수로 새로고침해도 이미 나온 문제는 다시 뽑히지 않습니다
(서버가 최근 12시간에 쓴 문제를 기억합니다).

`/admin`의 **통계** 메뉴에서는 등록된 문제의 난이도/단원별 분포와,
행사 기록(학생별 성공률, 아무도 못 맞힌 문제, 날짜별 활동)을 볼 수 있습니다.

## 폴더 구조

```
shared/db.js                          # 문제/행사기록 Postgres 모듈 (두 서버가 공유)
admin-server/                         # 로그인, 문제 CRUD API, Cloudinary 업로드, 관리 화면
admin-server/public/show.html         # 강당 전자칠판 진행 화면
admin-server/public/js/show.js        #   └ 진행 상태 전환(대기→문제→정답→상품)
admin-server/public/js/show-draw.js   #   └ 필기 엔진(벡터 저장 + 손바닥 걸러내기)
admin-server/public/js/show-anim.js   #   └ 연출(카운트다운/색종이/효과음)
admin-server/admin-dashboard-app/     # 통계 대시보드(React+Vite+Tailwind, /stats로 서빙)
main-server/                          # 공개 결과 페이지 (로그인 없음, 정답 노출 없음)
main-server/public/vendor/            # Anime.js / Motion 브라우저 빌드 자체 호스팅(CDN 의존 없음)
server.js                             # 배포용 통합 진입점 (main + admin을 한 포트에서 서빙)
render.yaml                           # Render 배포 블루프린트
tests/                                # 통합 테스트 (node:test + supertest + Playwright)
.github/workflows/ci.yml              # push/PR마다 테스트 + 대시보드 빌드를 실행하는 CI
```

## 테스트

```bash
npm test
```

`shared/db.js`의 CRUD, 진행 화면 API(로그인 없이는 정답이 안 나가는지 포함),
공개 페이지가 정답·사진·필기를 흘리지 않는지, admin-server의 인증/권한을
로컬 Postgres에 대고 검증합니다. `DATABASE_URL`이 로컬 테스트 DB를 가리키도록
하고 실행하세요 (운영 DB에 대고 돌리면 안 됩니다).

여기에 더해 실제 브라우저(Playwright)로 진행 화면 전체를 돌려봅니다 —
카운트다운 레이어가 화면을 덮은 채 남지 않는지, 캔버스가 판 전체를 정확히
덮는지, **사진 바깥 흰 여백에도 필기가 되는지**, 되돌리기/전체지우기,
일시정지가 실제로 멈추는지, 정답 공개부터 상품 등록까지 서버에 남는지.
행사 중에 막히면 되돌릴 방법이 없는 화면이라 회귀 테스트로 고정해뒀습니다.
브라우저가 없는 환경에서는 이 테스트만 자동으로 건너뜁니다
(`npx playwright install chromium`으로 설치).

CI(`.github/workflows/ci.yml`)는 push/PR마다 임시 Postgres 컨테이너와 크로미움을
띄워 위 테스트 전체와 관리자 대시보드 빌드를 자동으로 실행합니다.

## 운영 참고 (보안/신뢰성)

- 세션은 MemoryStore가 아니라 Postgres(connect-pg-simple)에 저장되어, 재시작해도
  로그인이 풀리지 않고 여러 인스턴스로 확장해도 세션이 공유됩니다.
- helmet(보안 헤더), express-rate-limit(로그인/정답 채점 무차별 대입 방지),
  compression, morgan(요청 로그)이 적용되어 있습니다.
- `/healthz`(main), `/admin/healthz`(admin)로 헬스체크가 가능하고, SIGTERM/SIGINT
  수신 시 진행 중인 요청을 마저 처리한 뒤 종료합니다(무중단 배포 대응).
- 관리자 페이지는 항상 같은 오리진에서만 호출되므로 CORS를 열어두지 않습니다
  (다른 사이트가 관리자 세션 쿠키로 API를 호출하지 못하도록).
