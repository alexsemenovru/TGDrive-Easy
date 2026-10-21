'use strict';

const TOKEN = window.TD_TOKEN;
const $ = (id) => document.getElementById(id);

const state = {
  items: [],
  selected: new Set(),
  nextOffset: 0,
  total: 0,
  loading: false,
  view: 'login',
  settings: null,
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(c));
  return node;
}

async function api(url, options = {}) {
  const headers = Object.assign({ 'x-td-token': TOKEN }, options.headers || {});
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, Object.assign({}, options, { headers }));
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(node, text, isError = false) {
  node.textContent = text || '';
  node.classList.toggle('error', !!isError);
}

function fmtSize(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
function showView(name) {
  state.view = name;
  $('settingsView').hidden = name !== 'settings';
  $('loginView').hidden = name !== 'login';
  $('filesView').hidden = name !== 'files';
  $('settingsBtn').textContent = name === 'settings' ? '✕ Close' : '⚙ Settings';
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function loadSettings() {
  try {
    const s = await api('/api/settings');
    state.settings = s;
    renderSettings(s);
  } catch (e) {
    setStatus($('settingsStatus'), e.message, true);
  }
}

function renderSettings(s) {
  $('driveInfo').textContent = s.mounted
    ? `Drive ${s.drive} is mounted (${s.mode}).`
    : `Drive ${s.drive} is not mounted (${s.mode}).`;
  $('autoMount').checked = !!s.autoMount;
  $('mountBtn').disabled = !!s.mounted;
  $('unmountBtn').disabled = !s.mounted;

  const p = s.proxy || { type: 'none' };
  $('proxyType').value = p.type || 'none';
  $('proxyHost').value = p.host || '';
  $('proxyPort').value = p.port || '';
  $('proxyUser').value = p.user || '';
  $('proxyPass').value = p.pass || '';
  $('proxySecret').value = p.secret || '';
  updateProxyFields();
}

function updateProxyFields() {
  const type = $('proxyType').value;
  $('proxyFields').hidden = type === 'none';
  $('socksFields').hidden = type !== 'socks5';
  $('mtFields').hidden = type !== 'mtproto';
}

$('proxyType').addEventListener('change', updateProxyFields);

$('autoMount').addEventListener('change', async () => {
  try {
    await api('/api/settings/auto-mount', {
      method: 'POST',
      body: JSON.stringify({ enabled: $('autoMount').checked }),
    });
    setStatus($('settingsStatus'), $('autoMount').checked
      ? 'The drive will be mounted at every start.'
      : 'The drive will not be mounted automatically.');
  } catch (e) {
    setStatus($('settingsStatus'), e.message, true);
  }
});

$('mountBtn').addEventListener('click', async () => {
  setStatus($('settingsStatus'), 'Mounting…');
  try {
    const out = await api('/api/mount', { method: 'POST' });
    setStatus($('settingsStatus'), out.mounted ? 'Drive mounted.' : 'Mount failed.');
    await loadSettings();
  } catch (e) {
    setStatus($('settingsStatus'), e.message, true);
  }
});

$('unmountBtn').addEventListener('click', async () => {
  setStatus($('settingsStatus'), 'Unmounting…');
  try {
    await api('/api/unmount', { method: 'POST' });
    setStatus($('settingsStatus'), 'Drive unmounted.');
    await loadSettings();
  } catch (e) {
    setStatus($('settingsStatus'), e.message, true);
  }
});

$('proxySave').addEventListener('click', async () => {
  const body = {
    type: $('proxyType').value,
    host: $('proxyHost').value.trim(),
    port: Number($('proxyPort').value) || 0,
    user: $('proxyUser').value.trim(),
    pass: $('proxyPass').value,
    secret: $('proxySecret').value.trim(),
  };
  if (body.type !== 'none' && (!body.host || !body.port)) {
    return setStatus($('settingsStatus'), 'Server and port are required.', true);
  }
  if (body.type === 'mtproto' && !body.secret) {
    return setStatus($('settingsStatus'), 'MTProto secret is required.', true);
  }
  setStatus($('settingsStatus'), 'Applying…');
  try {
    const out = await api('/api/settings/proxy', { method: 'POST', body: JSON.stringify(body) });
    let msg = 'Proxy saved.';
    if (out.connected) msg += ' Telegram connection restored.';
    else if (out.error) msg += ` Connection: ${out.error}`;
    else msg += ' Sign in to check the connection.';
    setStatus($('settingsStatus'), msg, !!out.error);
    await loadSettings();
  } catch (e) {
    setStatus($('settingsStatus'), e.message, true);
  }
});

function parseProxyLink(text) {
  const m = String(text || '').match(/tg:\/\/proxy\?([^\s]+)/i);
  if (!m) return false;
  const params = new URLSearchParams(m[1]);
  const server = params.get('server');
  const port = params.get('port');
  const secret = params.get('secret');
  if (!server || !port || !secret) return false;
  $('proxyType').value = 'mtproto';
  $('proxyHost').value = server;
  $('proxyPort').value = port;
  $('proxySecret').value = secret;
  updateProxyFields();
  return true;
}

$('proxyPaste').addEventListener('click', async () => {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    text = prompt('Paste a tg://proxy link:') || '';
  }
  if (!parseProxyLink(text)) {
    setStatus($('settingsStatus'), 'No tg://proxy link found in the clipboard.', true);
  } else {
    setStatus($('settingsStatus'), 'Link parsed — press "Save and apply".');
  }
});

$('settingsBtn').addEventListener('click', async () => {
  if (state.view === 'settings') {
    showView(state.authorized ? 'files' : 'login');
    return;
  }
  await loadSettings();
  showView('settings');
});

$('settingsClose').addEventListener('click', () => {
  showView(state.authorized ? 'files' : 'login');
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
function showStep(name) {
  for (const s of ['stepPhone', 'stepCode', 'stepPassword']) {
    $(s).hidden = s !== name;
  }
}

async function startLogin() {
  showView('login');
  showStep('stepPhone');
}

$('sendCodeBtn').addEventListener('click', async () => {
  const phone = $('phone').value.trim();
  if (!phone) return setStatus($('loginStatus'), 'Enter your phone number', true);
  const btn = $('sendCodeBtn');
  btn.disabled = true;
  setStatus($('loginStatus'), 'Sending code…');
  try {
    const out = await api('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ phone }) });
    showStep('stepCode');
    setStatus($('loginStatus'), '');
    $('codeHint').textContent = out.isCodeViaApp
      ? 'The code was sent to your Telegram app (chat "Telegram").'
      : 'The code was sent by SMS.';
    $('code').focus();
  } catch (e) {
    setStatus($('loginStatus'), e.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('backBtn').addEventListener('click', () => {
  showStep('stepPhone');
  setStatus($('loginStatus'), '');
});

async function finishLogin(data) {
  if (data.needPassword) {
    showStep('stepPassword');
    $('passwordHint').textContent = data.hint ? `Hint: ${data.hint}` : '';
    $('password').focus();
    return;
  }
  await enterApp();
}

$('signInBtn').addEventListener('click', async () => {
  const code = $('code').value.trim();
  if (!code) return setStatus($('loginStatus'), 'Enter the code', true);
  const btn = $('signInBtn');
  btn.disabled = true;
  setStatus($('loginStatus'), 'Checking code…');
  try {
    const out = await api('/api/auth/sign-in', { method: 'POST', body: JSON.stringify({ code }) });
    await finishLogin(out);
  } catch (e) {
    setStatus($('loginStatus'), e.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('passwordBtn').addEventListener('click', async () => {
  const password = $('password').value;
  if (!password) return setStatus($('loginStatus'), 'Enter the password', true);
  const btn = $('passwordBtn');
  btn.disabled = true;
  setStatus($('loginStatus'), 'Checking password…');
  try {
    await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ password }) });
    await enterApp();
  } catch (e) {
    setStatus($('loginStatus'), e.message, true);
  } finally {
    btn.disabled = false;
  }
});

$('logoutBtn').addEventListener('click', async () => {
  if (!confirm('Sign out of this account on this computer?')) return;
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  state.items = [];
  state.selected.clear();
  state.authorized = false;
  $('userBox').hidden = true;
  await startLogin();
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
async function enterApp() {
  const st = await api('/api/state');
  state.authorized = !!st.authorized;
  if (!state.authorized) return startLogin();
  $('userBox').hidden = false;
  $('userName').textContent = st.me.name || st.me.username || 'account';
  showView('files');
  await loadFiles(true);
}

function renderFiles() {
  const tbody = $('filesBody');
  tbody.innerHTML = '';
  const query = $('search').value.trim().toLowerCase();
  const visible = state.items.filter((i) => !query || i.name.toLowerCase().includes(query));

  if (!visible.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colspan: '5', class: 'muted', text: 'No files found' })]));
  }

  for (const item of visible) {
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = state.selected.has(item.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      syncSelection();
    });

    const link = el('a', {
      href: `/api/files/${item.id}/download?token=${encodeURIComponent(TOKEN)}`,
      text: 'Download',
    });

    tbody.appendChild(el('tr', {}, [
      el('td', { class: 'col-check' }, [checkbox]),
      el('td', { class: 'name', title: item.name, text: item.name }),
      el('td', { class: 'col-size', text: fmtSize(item.size) }),
      el('td', { class: 'col-date', text: fmtDate(item.date) }),
      el('td', { class: 'col-act dl' }, [link]),
    ]));
  }
  syncSelection();
}

function syncSelection() {
  const n = state.selected.size;
  $('downloadBtn').disabled = n === 0;
  $('downloadBtn').textContent = n ? `Download selected (${n})` : 'Download selected';
  $('checkAll').checked = n > 0 && n === state.items.length;
}

$('checkAll').addEventListener('change', (e) => {
  const query = $('search').value.trim().toLowerCase();
  const visible = state.items.filter((i) => !query || i.name.toLowerCase().includes(query));
  if (e.target.checked) visible.forEach((i) => state.selected.add(i.id));
  else state.selected.clear();
  renderFiles();
});

$('search').addEventListener('input', renderFiles);

$('refreshBtn').addEventListener('click', () => loadFiles(true, true));

async function loadFiles(reset, force) {
  if (state.loading) return;
  state.loading = true;
  setStatus($('filesStatus'), reset ? 'Loading list…' : 'Loading more…');
  try {
    const offset = reset ? 0 : state.nextOffset;
    const out = await api(`/api/files?limit=50&offset=${offset}${force ? '&refresh=1' : ''}`);
    if (reset) {
      state.items = out.items;
      state.selected.clear();
    } else {
      const known = new Set(state.items.map((i) => i.id));
      state.items.push(...out.items.filter((i) => !known.has(i.id)));
    }
    state.nextOffset = out.nextOffset || 0;
    state.total = out.total || state.items.length;
    $('moreBtn').hidden = !state.nextOffset;
    renderFiles();
    setStatus($('filesStatus'), `Showing ${state.items.length} of ${state.total}`);
  } catch (e) {
    setStatus($('filesStatus'), e.message, true);
  } finally {
    state.loading = false;
  }
}

$('moreBtn').addEventListener('click', () => loadFiles(false));

$('downloadBtn').addEventListener('click', async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  setStatus($('filesStatus'), `Downloading ${ids.length} file(s)… the browser will ask where to save.`);
  for (const id of ids) {
    const a = el('a', {
      href: `/api/files/${id}/download?token=${encodeURIComponent(TOKEN)}`,
      download: '',
      style: 'display:none',
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    await new Promise((r) => setTimeout(r, 800));
  }
  setStatus($('filesStatus'), 'Download requests sent.');
});

$('uploadInput').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  const form = new FormData();
  files.forEach((f) => form.append('files', f, f.name));
  setStatus($('filesStatus'), `Uploading ${files.length} file(s) to Saved Messages… this may take a while.`);
  $('uploadInput').disabled = true;
  try {
    const out = await api('/api/upload', { method: 'POST', body: form });
    setStatus($('filesStatus'), `Uploaded ${out.uploaded.length} of ${files.length}.`);
    await loadFiles(true);
  } catch (err) {
    setStatus($('filesStatus'), err.message, true);
  } finally {
    $('uploadInput').disabled = false;
    e.target.value = '';
  }
});

// ---------------------------------------------------------------------------
(async function init() {
  try {
    const st = await api('/api/state');
    state.authorized = !!st.authorized;
    if (st.authorized) await enterApp();
    else await startLogin();
  } catch (e) {
    showView('login');
    setStatus($('loginStatus'), `Server unavailable: ${e.message}`, true);
  }
})();
