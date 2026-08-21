# 스트릿매쓰파이터

난이도(상/중/하)별로 수학 문제(사진)를 풀어보는 서비스입니다. 학생은 문제 사진 위에 **펜**과 **지우개**로 직접 풀이를 써가며 문제를 풉니다. 두 개의 독립된 Express 서버로 구성되어 있습니다.

- **main-server**: 학생용 사이트. 난이도 선택 → 문제 목록 → 문제 풀이(펜/지우개)
- **admin-server**: 관리자 사이트. 로그인 후 문제 등록/수정/삭제(사진 업로드, 난이도 지정)

두 서버는 동일한 SQLite DB(`data.sqlite`)와 업로드 이미지 폴더(`uploads/`)를 공유합니다. admin-server에서 등록한 문제가 main-server에 바로 노출됩니다.

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

운영 실행: `npm run start:main`, `npm run start:admin`

## 환경변수 (`.env`)

| 변수 | 설명 | 기본값 |
| --- | --- | --- |
| `MAIN_PORT` | 학생용 서버 포트 | 3000 |
| `ADMIN_PORT` | 관리자 서버 포트 | 4000 |
| `ADMIN_USERNAME` | 관리자 로그인 아이디 | admin |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 | changeme123 |
| `SESSION_SECRET` | 세션 쿠키 서명 키 | (배포 전 반드시 변경) |

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
uploads/                # 업로드된 문제 이미지 (두 서버가 함께 참조)
```
