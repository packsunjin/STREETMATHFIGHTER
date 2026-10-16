// 행사용 문제 묶음(구글 슬라이드 "스트릿매쓰파이터 문제 수합"에서 옮김).
//
// 사진은 admin-server/public/problem-set/에 들고 있고, 서버가 뜰 때
// applyProblemSet()이 DB를 이 묶음으로 갈아끼운다. 갈아끼우는 건
// PROBLEM_SET_VERSION마다 딱 한 번이다. 한 번 들어간 뒤에 관리 화면에서
// 고치거나 더 등록한 문제는 재시작해도 건드리지 않는다.
// 문제를 통째로 다시 바꾸려면 PROBLEM_SET 내용과 함께 버전을 올린다.

const { pool, ready } = require('./db');

const PROBLEM_SET_VERSION = '2026-10-문제수합-3';

// 사진이 우리 서버에 있는 문제는 image_public_id가 이 접두어로 시작한다.
// Cloudinary에 지우라고 보내면 안 되는 표시다.
const LOCAL_IMAGE_PREFIX = 'local:';

// file: 슬라이드 번호 - 1 (슬라이드 1은 표지)
// answer: 객관식이면 '1'~'5', 주관식이면 화면 숫자판으로 칠 수 있는 형태
const PROBLEM_SET = [
  { file: '01.jpg', difficulty: '상', unit: '중3 수학', author: '김태완', type: 'subjective', answer: '2' },
  { file: '02.jpg', difficulty: '상', unit: '대수', author: '김다연', type: 'subjective', answer: '47' },
  { file: '03.jpg', difficulty: '상', unit: '공통수학1', author: '구현지', type: 'objective', answer: '3' },
  { file: '04.jpg', difficulty: '상', unit: '공통수학2', author: '김다연', type: 'subjective', answer: '38' },
  // 슬라이드에는 "9분의 4"로 적혀 있지만 S(t)=½(t²-√t)(t-1)이라 극한은 3/4이다.
  { file: '05.jpg', difficulty: '상', unit: '미적분', author: '한성률', type: 'subjective', answer: '3/4' },
  { file: '06.jpg', difficulty: '중', unit: '공통수학1', author: '구현지', type: 'subjective', answer: '23' },
  { file: '07.jpg', difficulty: '중', unit: '대수', author: '김다연', type: 'objective', answer: '3' },
  { file: '08.jpg', difficulty: '중', unit: '대수', author: '구현지', type: 'subjective', answer: '12' },
  { file: '09.jpg', difficulty: '중', unit: '대수(삼각함수)', author: '김지영', type: 'objective', answer: '4' },
  { file: '11.jpg', difficulty: '중', unit: '기하', author: '김태완', type: 'objective', answer: '3' },
  { file: '12.jpg', difficulty: '중', unit: '대수', author: '김다연', type: 'objective', answer: '3' },
  { file: '13.jpg', difficulty: '중', unit: '기하', author: '김태완', type: 'objective', answer: '5' },
  { file: '14.jpg', difficulty: '중', unit: '기하', author: '', type: 'objective', answer: '4' },
  { file: '15.jpg', difficulty: '중', unit: '기하', author: '', type: 'subjective', answer: '10' },
  // 슬라이드에는 0.8로 적혀 있지만 0.064 = 0.4³이라 실수인 세제곱근은 0.4다.
  { file: '16.jpg', difficulty: '하', unit: '대수', author: '구현지', type: 'subjective', answer: '0.4' },
  { file: '17.jpg', difficulty: '하', unit: '공통수학1', author: '김다연', type: 'objective', answer: '2' },
  { file: '18.jpg', difficulty: '하', unit: '공통수학1', author: '구현지', type: 'objective', answer: '4' },
  { file: '19.jpg', difficulty: '하', unit: '공통수학2', author: '구현지', type: 'objective', answer: '4' },
  { file: '20.jpg', difficulty: '하', unit: '대수(수열)', author: '김지영', type: 'subjective', answer: '462' },
  // 김지영(중)·김다연(하) 두 슬라이드에 똑같이 들어 있던 문제라 한 번만 낸다.
  // 그래프에서 최댓값·최솟값·주기만 읽으면 되는 문제라 하에 둔다.
  { file: '21.jpg', difficulty: '하', unit: '대수(삼각함수)', author: '김지영, 김다연', type: 'objective', answer: '1' },
  { file: '22.jpg', difficulty: '하', unit: '공통수학1', author: '오현준', type: 'subjective', answer: '29' },
];

const META_SQL = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// 다른 인스턴스와 동시에 갈아끼우지 않도록 잡는 자문 잠금 번호(db.js와 다른 값)
const PROBLEM_SET_LOCK_ID = 771103;

/**
 * DB의 문제를 이 묶음으로 갈아끼운다. 이미 이 버전이 들어가 있으면 아무것도 안 한다.
 * force면 버전과 상관없이 다시 갈아끼운다.
 * 돌려주는 값: { applied, removed, inserted, removedPublicIds }
 *   removedPublicIds는 지워진 문제 중 Cloudinary에 사진이 있던 것(호출한 쪽이 지운다).
 */
async function applyProblemSet({ force = false } = {}) {
  await ready; // problems 표가 먼저 있어야 한다
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [PROBLEM_SET_LOCK_ID]);
    await client.query(META_SQL);

    const { rows: meta } = await client.query(
      "SELECT value FROM app_meta WHERE key = 'problem_set'"
    );
    if (!force && meta[0] && meta[0].value === PROBLEM_SET_VERSION) {
      return { applied: false, removed: 0, inserted: 0, removedPublicIds: [] };
    }

    await client.query('BEGIN');
    try {
      const { rows: removed } = await client.query(
        'DELETE FROM problems RETURNING image_public_id'
      );
      // 묶음 순서대로 created_at이 조금씩 늘어나게 넣는다(관리 목록이 뒤죽박죽이 되지 않게).
      for (const [i, p] of PROBLEM_SET.entries()) {
        const no = String(i + 1).padStart(2, '0');
        await client.query(
          `INSERT INTO problems
             (title, difficulty, image_path, image_public_id, description, question_type, answer, unit, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - make_interval(secs => $9))`,
          [
            `${no}. ${p.unit}`,
            p.difficulty,
            `/problem-set/${p.file}`,
            `${LOCAL_IMAGE_PREFIX}problem-set/${p.file}`,
            p.author ? `출제자: ${p.author}` : null,
            p.type,
            p.answer,
            p.unit,
            i,
          ]
        );
      }
      await client.query(
        `INSERT INTO app_meta (key, value) VALUES ('problem_set', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [PROBLEM_SET_VERSION]
      );
      await client.query('COMMIT');

      return {
        applied: true,
        removed: removed.length,
        inserted: PROBLEM_SET.length,
        removedPublicIds: removed
          .map((r) => r.image_public_id)
          .filter((id) => id && !id.startsWith(LOCAL_IMAGE_PREFIX)),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [PROBLEM_SET_LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = {
  PROBLEM_SET,
  PROBLEM_SET_VERSION,
  LOCAL_IMAGE_PREFIX,
  applyProblemSet,
};
