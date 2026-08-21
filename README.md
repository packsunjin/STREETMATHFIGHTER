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

## GitHub 리포로 웹사이트 배포하기

GitHub Pages는 정적 파일만 서빙하므로 로그인·DB·이미지 업로드가 필요한 이 서비스는 열 수 없습니다. 신용카드 없이 완전 무료로 열려면 **Glitch**를 권장합니다.

### Glitch (완전 무료, 신용카드 불필요)

1. [glitch.com](https://glitch.com)에 가입 (GitHub 계정으로 로그인 가능)
2. **New Project → Import from GitHub** 선택 → 이 저장소 주소(`https://github.com/P-SUNJiN/STREETMATHFIGHTER`) 입력
3. Glitch가 `package.json`을 인식해 자동으로 `npm install` 후 `npm start`(`server.js`)를 실행합니다.
4. Glitch 에디터에서 프로젝트 루트에 `.env` 파일을 새로 만들고 아래처럼 채워주세요 (`.env`는 git에 포함되지 않으므로 직접 입력해야 합니다).
   ```
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=원하는-안전한-비밀번호
   SESSION_SECRET=임의의-긴-문자열
   DATA_DIR=.data
   ```
   `DATA_DIR=.data`가 핵심입니다. Glitch는 `.data/` 폴더를 **영구 저장 전용 공간**으로 취급해서, 프로젝트가 잠들었다가(5분 미접속 시 슬립) 다음 요청에 다시 깨어나도 그 안의 `data.sqlite`와 업로드 이미지가 그대로 유지됩니다. (이 리포는 이미 이 설정을 반영해뒀습니다.)
5. 배포된 주소(`https://<프로젝트명>.glitch.me`)로 접속하면:
   - `/` → 학생용 메인 사이트
   - `/admin` → 관리자 사이트

주의: Glitch의 GitHub Import는 **1회성 복사**입니다. 이후 로컬에서 코드를 고쳐 GitHub에 `git push`해도 Glitch에 자동 반영되지 않으니, Glitch 에디터의 **Tools → Import and Export → GitHub Import**를 다시 실행해 최신 코드를 동기화해야 합니다. 그리고 5분간 요청이 없으면 서버가 잠들었다가 다음 접속 시 몇 초간 깨어나는 지연이 있을 수 있습니다.

### Render (유료 플랜에서만 데이터 유지)

리포에는 [Render](https://render.com)용 `render.yaml`도 포함되어 있습니다. GitHub 저장소를 Render에 연결 → **New > Blueprint**로 배포하면 됩니다. 단, 문제/이미지가 재시작 후에도 유지되려면 **영구 디스크(유료 플랜, starter 이상)** 가 필요합니다. `render.yaml`에서 `disk`와 `DATA_DIR`을 지우고 `plan: free`로 바꾸면 무료로 돌릴 수 있지만, 서버가 재시작될 때마다 등록된 문제가 초기화됩니다.

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
