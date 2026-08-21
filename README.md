# 스트릿매쓰파이터

난이도(상/중/하)별로 수학 문제(사진)를 풀어보는 서비스입니다. 학생은 문제 사진 위에 **펜**과 **지우개**로 직접 풀이를 써가며 문제를 풉니다.

- **main-server**: 학생용 사이트. 난이도 선택 → 문제 목록 → 문제 풀이(펜/지우개)
- **admin-server**: 관리자 사이트. 로그인 후 문제 등록/수정/삭제(사진 업로드, 난이도 지정)

두 사이트는 동일한 SQLite DB(`data.sqlite`)와 업로드 이미지 폴더(`uploads/`)를 공유합니다. admin-server에서 등록한 문제가 main-server에 바로 노출됩니다. 로컬 개발에서는 두 개의 독립된 Express 서버(포트 분리)로 실행하고, 배포 시에는 `server.js`가 두 사이트를 하나의 서비스(`/`, `/admin`)로 묶어 실행합니다.

## 시작하기

```bash
npm install
cp .env.example .env   # 필요시 관리자 계정/포트 수정
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
| `MAIN_PORT` | (로컬 개발) 학생용 서버 포트 | 3000 |
| `ADMIN_PORT` | (로컬 개발) 관리자 서버 포트 | 4000 |
| `PORT` | (배포) 통합 서버가 사용할 단일 포트 | 3000, 대부분 호스팅에서 자동 주입 |
| `ADMIN_USERNAME` | 관리자 로그인 아이디 | admin |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 | changeme123 |
| `SESSION_SECRET` | 세션 쿠키 서명 키 | (배포 전 반드시 변경) |
| `DATA_DIR` | DB/업로드 이미지 저장 경로 | 비어있으면 프로젝트 루트 |

## GitHub 리포로 웹사이트 배포하기 (Render)

GitHub Pages는 정적 파일만 서빙하므로 로그인·DB·이미지 업로드가 필요한 이 서비스는 열 수 없습니다. 대신 리포에 포함된 `render.yaml`로 [Render](https://render.com)에 바로 배포할 수 있습니다.

1. GitHub 저장소를 Render에 연결 → **New > Blueprint** 선택 → 이 리포 선택 (`render.yaml`을 자동으로 인식)
2. 배포 시 `ADMIN_USERNAME`, `ADMIN_PASSWORD` 값을 Render 대시보드에서 입력 (안전한 비밀번호로)
3. 배포가 끝나면 하나의 URL로 다음처럼 접속합니다.
   - `https://<서비스주소>/` → 학생용 메인 사이트
   - `https://<서비스주소>/admin` → 관리자 사이트

`render.yaml`은 영구 디스크(`/var/data`)를 붙여 `DATA_DIR=/var/data`로 지정하므로, 재배포/재시작 후에도 등록한 문제와 이미지가 유지됩니다. 단, **영구 디스크는 Render 유료 플랜(starter 이상)** 에서만 지원됩니다. 데이터 유지가 필요 없는 테스트용이라면 `render.yaml`에서 `disk` 항목과 `DATA_DIR`을 지우고 `plan: free`로 바꿔도 되지만, 이 경우 서버가 재시작될 때마다 등록된 문제가 초기화됩니다.

Railway 등 다른 호스팅도 원리는 같습니다: 빌드 `npm install`, 시작 `npm start`, 영구 볼륨을 하나 붙이고 그 경로를 `DATA_DIR`로 지정하면 됩니다.

## 사용 흐름

1. `admin-server`(`http://localhost:4000`)에 로그인 → 문제 제목, 난이도(상/중/하), 문제 사진, (선택) 설명/해설을 입력해 등록
2. `main-server`(`http://localhost:3000`)에서 난이도 카드를 선택 → 해당 난이도 문제 목록에서 문제 선택
3. 문제 사진 위에 **펜**으로 풀이를 쓰고 **지우개**로 지우며 풀이, 필요시 전체 지우기
4. 등록된 설명/해설이 있으면 "설명 / 해설 보기"로 확인 가능

## 폴더 구조

```
shared/db.js          # 문제 CRUD를 위한 SQLite 모듈 (두 서버가 공유)
admin-server/          # 관리자 서버 (로그인, 문제 CRUD API, 관리 화면)
main-server/            # 학생용 서버 (문제 조회 API, 풀이 화면)
server.js               # 배포용 통합 진입점 (main + admin을 한 포트에서 서빙)
render.yaml              # Render 배포 블루프린트
uploads/                # 업로드된 문제 이미지 (두 서버가 함께 참조)
```
