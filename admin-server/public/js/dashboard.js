let currentDifficultyFilter = '';
let selectedProblemId = null;
let problemsCache = [];

const problemList = document.getElementById('problemList');
const emptyState = document.getElementById('emptyState');
const problemForm = document.getElementById('problemForm');
const formTitle = document.getElementById('formTitle');
const submitBtn = document.getElementById('submitBtn');
const problemIdInput = document.getElementById('problemId');
const titleInput = document.getElementById('title');
const difficultyInput = document.getElementById('difficulty');
const unitInput = document.getElementById('unit');
const unitOptions = document.getElementById('unitOptions');
const imageInput = document.getElementById('image');
const imagePreview = document.getElementById('imagePreview');
const descriptionInput = document.getElementById('description');
const toast = document.getElementById('toast');
const answerFieldObjective = document.getElementById('answerFieldObjective');
const answerFieldSubjective = document.getElementById('answerFieldSubjective');
const answerText = document.getElementById('answerText');

function updateAnswerFieldVisibility() {
  const checkedType = document.querySelector('input[name="questionType"]:checked');
  const isObjective = checkedType?.value === 'objective';
  answerFieldObjective.style.display = isObjective ? 'block' : 'none';
  answerFieldSubjective.style.display = isObjective ? 'none' : 'block';
}

document.querySelectorAll('input[name="questionType"]').forEach((radio) => {
  radio.addEventListener('change', updateAnswerFieldVisibility);
});

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

async function checkAuth() {
  const res = await fetch('api/me', { credentials: 'include' });
  const data = await res.json();
  if (!data.authenticated) {
    window.location.href = 'index.html';
    return;
  }
  document.getElementById('whoami').textContent = `${data.username}님`;
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('api/logout', { method: 'POST', credentials: 'include' });
  window.location.href = 'index.html';
});

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentDifficultyFilter = btn.dataset.difficulty;
    loadProblems();
  });
});

async function loadUnits() {
  const res = await fetch('api/units', { credentials: 'include' });
  const data = await res.json();
  unitOptions.innerHTML = '';
  (data.units || []).forEach((unit) => {
    const opt = document.createElement('option');
    opt.value = unit;
    unitOptions.appendChild(opt);
  });
}

async function loadProblems() {
  const qs = currentDifficultyFilter ? `?difficulty=${encodeURIComponent(currentDifficultyFilter)}` : '';
  const res = await fetch(`api/problems${qs}`, { credentials: 'include' });
  const data = await res.json();
  problemsCache = data.problems || [];
  renderList();
}

function renderList() {
  problemList.innerHTML = '';
  emptyState.style.display = problemsCache.length === 0 ? 'block' : 'none';

  problemsCache.forEach((problem) => {
    const li = document.createElement('li');
    li.className = 'problem-item' + (problem.id === selectedProblemId ? ' selected' : '');
    li.innerHTML = `
      <img alt="" />
      <div class="meta">
        <div class="title">${escapeHtml(problem.title)}</div>
        <span class="badge ${problem.difficulty}">${problem.difficulty}</span>
        <span class="badge type">${problem.questionType === 'objective' ? '객관식' : '주관식'}</span>
        ${problem.unit ? `<span class="badge type">${escapeHtml(problem.unit)}</span>` : ''}
      </div>
      <button class="btn-danger" data-id="${problem.id}">삭제</button>
    `;
    // src는 문자열로 끼워넣지 않는다(따옴표가 섞이면 속성이 깨질 수 있음)
    li.querySelector('img').src = problem.imageUrl;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-danger')) return;
      loadIntoForm(problem);
    });
    li.querySelector('.btn-danger').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${problem.title}" 문제를 삭제할까요?`)) return;
      const res = await fetch(`api/problems/${problem.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        showToast('삭제되었습니다.');
        if (selectedProblemId === problem.id) resetForm();
        loadProblems();
      } else {
        showToast('삭제에 실패했습니다.');
      }
    });
    problemList.appendChild(li);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function loadIntoForm(problem) {
  selectedProblemId = problem.id;
  problemIdInput.value = problem.id;
  titleInput.value = problem.title;
  difficultyInput.value = problem.difficulty;
  unitInput.value = problem.unit || '';
  descriptionInput.value = problem.description || '';
  const typeRadio = document.querySelector(
    `input[name="questionType"][value="${problem.questionType === 'objective' ? 'objective' : 'subjective'}"]`
  );
  if (typeRadio) typeRadio.checked = true;
  updateAnswerFieldVisibility();
  document.querySelectorAll('input[name="answerChoice"]').forEach((r) => (r.checked = false));
  if (problem.questionType === 'objective') {
    const choiceRadio = document.querySelector(`input[name="answerChoice"][value="${problem.answer || ''}"]`);
    if (choiceRadio) choiceRadio.checked = true;
    answerText.value = '';
  } else {
    answerText.value = problem.answer || '';
  }
  imagePreview.src = problem.imageUrl;
  imagePreview.style.display = 'block';
  imageInput.value = ''; // 수정에서 사진을 안 바꾸면 기존 사진을 그대로 둔다
  imageInput.required = false;
  dropzoneHint.hidden = true;
  dropzoneFile.hidden = false;
  dropzoneFile.textContent = '등록된 사진 · 바꾸려면 새로 넣어주세요';
  formTitle.textContent = '문제 수정';
  submitBtn.textContent = '수정 저장';
  renderList();
}

function resetForm() {
  selectedProblemId = null;
  problemForm.reset();
  problemIdInput.value = '';
  imagePreview.style.display = 'none';
  if (imagePreview.dataset.objectUrl) {
    URL.revokeObjectURL(imagePreview.dataset.objectUrl);
    delete imagePreview.dataset.objectUrl;
  }
  imagePreview.src = '';
  dropzoneHint.hidden = false;
  dropzoneFile.hidden = true;
  formTitle.textContent = '새 문제 등록';
  submitBtn.textContent = '등록하기';
  updateAnswerFieldVisibility();
  renderList();
}

document.getElementById('resetBtn').addEventListener('click', resetForm);

/* ---- 이미지 넣기: 클릭 / 드래그앤드롭 / 붙여넣기 ----
   문제집을 찍거나 화면을 캡처해서 올리는 흐름이라, 파일 탐색기를 거치지 않고
   바로 넣을 수 있는 길을 열어둔다. */

const dropzone = document.getElementById('dropzone');
const dropzoneHint = document.getElementById('dropzoneHint');
const dropzoneFile = document.getElementById('dropzoneFile');

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 고른 파일을 input에 담고 미리보기를 띄운다. */
function useImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('이미지 파일만 넣을 수 있어요.');
    return;
  }

  // input.files는 직접 못 넣으므로 DataTransfer를 거쳐 폼 전송에 실리게 한다
  const transfer = new DataTransfer();
  transfer.items.add(file);
  imageInput.files = transfer.files;

  if (imagePreview.dataset.objectUrl) URL.revokeObjectURL(imagePreview.dataset.objectUrl);
  const url = URL.createObjectURL(file);
  imagePreview.dataset.objectUrl = url;
  imagePreview.src = url;
  imagePreview.style.display = 'block';

  dropzoneHint.hidden = true;
  dropzoneFile.hidden = false;
  dropzoneFile.textContent = `${file.name || '붙여넣은 이미지'} · ${formatSize(file.size)}`;
}

imageInput.addEventListener('change', () => {
  if (imageInput.files[0]) useImageFile(imageInput.files[0]);
});

dropzone.addEventListener('click', () => imageInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    imageInput.click();
  }
});

['dragenter', 'dragover'].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragging');
  })
);
['dragleave', 'drop'].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragging');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file) useImageFile(file);
});

// 캡처(Ctrl+V)는 페이지 어디에서 눌러도 받는다. 단, 글자를 입력하는 중이면
// 텍스트 붙여넣기를 방해하면 안 되므로 이미지가 들어 있을 때만 가로챈다.
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (!item) return;
  e.preventDefault();
  useImageFile(item.getAsFile());
});

problemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('title', titleInput.value.trim());
  formData.append('difficulty', difficultyInput.value);
  formData.append('unit', unitInput.value.trim());
  formData.append('description', descriptionInput.value.trim());
  const checkedType = document.querySelector('input[name="questionType"]:checked');
  const isObjective = checkedType?.value === 'objective';
  formData.append('questionType', checkedType ? checkedType.value : 'subjective');

  if (isObjective) {
    const checkedChoice = document.querySelector('input[name="answerChoice"]:checked');
    formData.append('answer', checkedChoice ? checkedChoice.value : '');
  } else {
    formData.append('answer', answerText.value.trim());
  }

  if (imageInput.files[0]) {
    formData.append('image', imageInput.files[0]);
  }

  const isEdit = Boolean(problemIdInput.value);
  const url = isEdit ? `api/problems/${problemIdInput.value}` : 'api/problems';
  const method = isEdit ? 'PUT' : 'POST';

  submitBtn.disabled = true;
  try {
    const res = await fetch(url, { method, credentials: 'include', body: formData });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || '저장에 실패했습니다.');
      return;
    }
    showToast(isEdit ? '수정되었습니다.' : '등록되었습니다.');
    resetForm();
    loadProblems();
    loadUnits();
  } catch (err) {
    showToast('서버에 연결할 수 없습니다.');
  } finally {
    submitBtn.disabled = false;
  }
});

updateAnswerFieldVisibility();
checkAuth().then(() => {
  loadProblems();
  loadUnits();
});
