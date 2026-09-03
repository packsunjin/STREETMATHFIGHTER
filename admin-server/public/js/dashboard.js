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
const imageInput = document.getElementById('image');
const imagePreview = document.getElementById('imagePreview');
const descriptionInput = document.getElementById('description');
const toast = document.getElementById('toast');

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
      <img src="${problem.imageUrl}" alt="" />
      <div class="meta">
        <div class="title">${escapeHtml(problem.title)}</div>
        <span class="badge ${problem.difficulty}">${problem.difficulty}</span>
        <span class="badge type">${problem.questionType === 'objective' ? '객관식' : '주관식'}</span>
      </div>
      <button class="btn-danger" data-id="${problem.id}">삭제</button>
    `;
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
  descriptionInput.value = problem.description || '';
  const typeRadio = document.querySelector(
    `input[name="questionType"][value="${problem.questionType === 'objective' ? 'objective' : 'subjective'}"]`
  );
  if (typeRadio) typeRadio.checked = true;
  imagePreview.src = problem.imageUrl;
  imagePreview.style.display = 'block';
  imageInput.required = false;
  formTitle.textContent = '문제 수정';
  submitBtn.textContent = '수정 저장';
  renderList();
}

function resetForm() {
  selectedProblemId = null;
  problemForm.reset();
  problemIdInput.value = '';
  imagePreview.style.display = 'none';
  imagePreview.src = '';
  formTitle.textContent = '새 문제 등록';
  submitBtn.textContent = '등록하기';
  renderList();
}

document.getElementById('resetBtn').addEventListener('click', resetForm);

imageInput.addEventListener('change', () => {
  const file = imageInput.files[0];
  if (!file) return;
  imagePreview.src = URL.createObjectURL(file);
  imagePreview.style.display = 'block';
});

problemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData();
  formData.append('title', titleInput.value.trim());
  formData.append('difficulty', difficultyInput.value);
  formData.append('description', descriptionInput.value.trim());
  const checkedType = document.querySelector('input[name="questionType"]:checked');
  formData.append('questionType', checkedType ? checkedType.value : 'subjective');
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
  } catch (err) {
    showToast('서버에 연결할 수 없습니다.');
  } finally {
    submitBtn.disabled = false;
  }
});

checkAuth().then(loadProblems);
