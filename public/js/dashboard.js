const STORAGE_KEY = 'keyauth_app';
const API_BASE = window.location.origin;

function getApp() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : null;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

async function sellerCall(action, params = {}) {
  const app = getApp();
  if (!app) { window.location.href = '/'; return; }
  const query = new URLSearchParams({ action, ownerid: app.ownerId, secret: app.secret, ...params });
  const res = await fetch(`${API_BASE}/api/seller?${query}`);
  return res.json();
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
}

let currentTab = 'overview';

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
  if (tab === 'licenses') loadLicenses();
  if (tab === 'users') loadUsers();
  if (tab === 'variables') loadVariables();
  if (tab === 'blacklist') loadBlacklist();
  if (tab === 'settings') loadSettings();
}

async function loadStats() {
  const res = await sellerCall('fetchstats');
  if (res.success) {
    document.getElementById('statUsers').textContent = res.stats.users;
    document.getElementById('statLicenses').textContent = res.stats.licenses;
    document.getElementById('statUnused').textContent = res.stats.unusedLicenses;
    document.getElementById('statSessions').textContent = res.stats.sessions;
  }
}

async function loadLicenses() {
  const res = await sellerCall('fetchlicenses');
  const tbody = document.getElementById('licensesTable');
  if (!res.success) { tbody.innerHTML = '<tr><td colspan="6">Failed to load</td></tr>'; return; }

  tbody.innerHTML = res.licenses.map(l => `
    <tr>
      <td><code>${l.key}</code> <button class="btn btn-sm btn-secondary" onclick="copyText('${l.key}')">Copy</button></td>
      <td>${l.used ? '<span class="badge badge-warning">Used</span>' : '<span class="badge badge-success">Unused</span>'}</td>
      <td>${l.banned ? '<span class="badge badge-danger">Banned</span>' : '<span class="badge badge-success">Active</span>'}</td>
      <td>${l.usedBy || '-'}</td>
      <td>${l.duration} ${l.durationUnit}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="deleteLicense('${l.key}')">Delete</button>
        ${l.banned
          ? `<button class="btn btn-sm btn-secondary" onclick="unbanLicense('${l.key}')">Unban</button>`
          : `<button class="btn btn-sm btn-secondary" onclick="banLicense('${l.key}')">Ban</button>`}
      </td>
    </tr>
  `).join('');
}

async function loadUsers() {
  const res = await sellerCall('fetchusers');
  const tbody = document.getElementById('usersTable');
  if (!res.success) { tbody.innerHTML = '<tr><td colspan="5">Failed to load</td></tr>'; return; }

  tbody.innerHTML = res.users.map(u => `
    <tr>
      <td>${u.username}</td>
      <td>${u.subscription ? new Date(u.subscription).toLocaleDateString() : 'None'}</td>
      <td><code>${(u.hwid || '-').substring(0, 16)}</code></td>
      <td>${u.banned ? '<span class="badge badge-danger">Banned</span>' : '<span class="badge badge-success">Active</span>'}</td>
      <td>
        <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.username}')">Delete</button>
        ${u.banned
          ? `<button class="btn btn-sm btn-secondary" onclick="unbanUser('${u.username}')">Unban</button>`
          : `<button class="btn btn-sm btn-secondary" onclick="banUser('${u.username}')">Ban</button>`}
        <button class="btn btn-sm btn-secondary" onclick="addTime('${u.username}')">+30d</button>
      </td>
    </tr>
  `).join('');
}

async function loadVariables() {
  const res = await sellerCall('fetchvars');
  const tbody = document.getElementById('varsTable');
  if (!res.success) { tbody.innerHTML = '<tr><td colspan="4">Failed to load</td></tr>'; return; }

  tbody.innerHTML = res.variables.map(v => `
    <tr>
      <td>${v.varId}</td>
      <td>${v.value}</td>
      <td>${v.authed ? 'Yes' : 'No'}</td>
      <td><button class="btn btn-sm btn-danger" onclick="deleteVar('${v.varId}')">Delete</button></td>
    </tr>
  `).join('');
}

async function loadBlacklist() {
  const res = await sellerCall('fetchblacklist');
  const tbody = document.getElementById('blacklistTable');
  if (!res.success) { tbody.innerHTML = '<tr><td colspan="4">Failed to load</td></tr>'; return; }

  tbody.innerHTML = res.blacklist.map(b => `
    <tr>
      <td>${b.type}</td>
      <td><code>${b.value}</code></td>
      <td>${b.reason || '-'}</td>
      <td><button class="btn btn-sm btn-danger" onclick="removeBlacklist('${b.type}','${b.value}')">Remove</button></td>
    </tr>
  `).join('');
}

function loadSettings() {
  const app = getApp();
  if (!app) return;
  document.getElementById('settingsName').value = app.name;
  document.getElementById('settingsOwnerId').textContent = app.ownerId;
  document.getElementById('settingsSecret').textContent = app.secret;
  document.getElementById('settingsVersion').value = app.version || '1.0';
}

async function createLicenses() {
  const amount = document.getElementById('licenseAmount').value;
  const duration = document.getElementById('licenseDuration').value;
  const unit = document.getElementById('licenseUnit').value;
  const note = document.getElementById('licenseNote').value;
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  const res = await sellerCall('createlicense', { amount, duration, durationUnit: unit, note });
  btn.disabled = false;
  btn.textContent = 'Generate Keys';
  if (res.success) {
    showToast(`${res.keys.length} license(s) created!`);
    document.getElementById('createdKeys').innerHTML = res.keys.map(k =>
      `<div class="code-block" style="margin-top:8px">${k} <button class="btn btn-sm btn-secondary" onclick="copyText('${k}')">Copy</button></div>`
    ).join('');
    loadLicenses();
    loadStats();
  } else {
    showToast(res.message, 'error');
  }
}

async function createBulkLicenses() {
  document.getElementById('licenseAmount').value = '1000';
  document.getElementById('licenseUnit').value = 'lifetime';
  await createLicenses();
}

async function deleteLicense(key) {
  if (!confirm('Delete this license?')) return;
  const res = await sellerCall('deletelicense', { key });
  showToast(res.message, res.success ? 'success' : 'error');
  loadLicenses(); loadStats();
}

async function banLicense(key) {
  const res = await sellerCall('banlicense', { key });
  showToast(res.message, res.success ? 'success' : 'error');
  loadLicenses();
}

async function unbanLicense(key) {
  const res = await sellerCall('unbanlicense', { key });
  showToast(res.message, res.success ? 'success' : 'error');
  loadLicenses();
}

async function deleteUser(username) {
  if (!confirm(`Delete user ${username}?`)) return;
  const res = await sellerCall('deleteuser', { username });
  showToast(res.message, res.success ? 'success' : 'error');
  loadUsers(); loadStats();
}

async function banUser(username) {
  const res = await sellerCall('banuser', { username });
  showToast(res.message, res.success ? 'success' : 'error');
  loadUsers();
}

async function unbanUser(username) {
  const res = await sellerCall('unbanuser', { username });
  showToast(res.message, res.success ? 'success' : 'error');
  loadUsers();
}

async function addTime(username) {
  const res = await sellerCall('addtime', { username, days: '30' });
  showToast(res.message, res.success ? 'success' : 'error');
  loadUsers();
}

async function addVariable() {
  const varId = document.getElementById('varId').value;
  const value = document.getElementById('varValue').value;
  const authed = document.getElementById('varAuthed').checked;
  const res = await sellerCall('setvar', { varid: varId, value, authed: authed.toString() });
  showToast(res.message, res.success ? 'success' : 'error');
  loadVariables();
}

async function deleteVar(varId) {
  const res = await sellerCall('delvar', { varid: varId });
  showToast(res.message, res.success ? 'success' : 'error');
  loadVariables();
}

async function addBlacklist() {
  const type = document.getElementById('blType').value;
  const value = document.getElementById('blValue').value;
  const reason = document.getElementById('blReason').value;
  const res = await sellerCall('addblacklist', { blacklistType: type, value, reason });
  showToast(res.message, res.success ? 'success' : 'error');
  loadBlacklist();
}

async function removeBlacklist(type, value) {
  const res = await sellerCall('delblacklist', { blacklistType: type, value });
  showToast(res.message, res.success ? 'success' : 'error');
  loadBlacklist();
}

async function saveSettings() {
  const name = document.getElementById('settingsName').value;
  const version = document.getElementById('settingsVersion').value;
  const res = await sellerCall('updateapp', { name, version });
  if (res.success) {
    const app = getApp();
    app.name = name;
    app.version = version;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(app));
    showToast('Settings saved!');
  } else {
    showToast(res.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = getApp();
  if (!app) { window.location.href = '/'; return; }

  document.getElementById('dashAppName').textContent = app.name;
  document.getElementById('dashOwnerId').textContent = app.ownerId;

  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(t.dataset.tab);
    });
  });

  loadStats();
  switchTab('overview');
});
