const STORAGE_KEY = 'keyauth_app';
const API_BASE = window.location.origin;

function getApp() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : null;
}

function saveApp(app) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app));
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function apiCall(endpoint, options = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  return res.json();
}

async function sellerCall(action, params = {}) {
  const app = getApp();
  if (!app) throw new Error('No app found');
  const query = new URLSearchParams({ action, ownerid: app.ownerId, secret: app.secret, ...params });
  return apiCall(`/api/seller?${query}`);
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
}

async function autoCreateApp() {
  const existing = getApp();
  if (existing) return existing;

  const res = await apiCall('/api/app/create', {
    method: 'POST',
    body: JSON.stringify({ name: '' }),
  });

  if (res.success) {
    saveApp(res.app);
    return res.app;
  }
  throw new Error(res.message);
}

document.addEventListener('DOMContentLoaded', async () => {
  const createBtn = document.getElementById('createAppBtn');
  const dashboardBtn = document.getElementById('dashboardBtn');
  const appInfo = document.getElementById('appInfo');

  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating...';
      try {
        await autoCreateApp();
        showToast('Application created! Redirecting to dashboard...');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
      } catch (err) {
        showToast(err.message, 'error');
        createBtn.disabled = false;
        createBtn.textContent = 'Create Application — Free';
      }
    });
  }

  const app = getApp();
  if (app && appInfo) {
    appInfo.style.display = 'block';
    document.getElementById('appName').textContent = app.name;
    document.getElementById('appOwnerId').textContent = app.ownerId;
    if (dashboardBtn) dashboardBtn.style.display = 'inline-flex';
  }
});
