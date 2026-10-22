'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { once } = require('events');
const { execFile, execFileSync, spawn } = require('child_process');
const platform = require('./platform');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

// Данные (сессия, настройки, индекс) можно держать отдельно от кода — так
// делает EXE-лаунчер, распаковывая сервер в отдельный каталог.
const DATA_DIR = process.env.TD_DATA_DIR
  ? path.resolve(process.env.TD_DATA_DIR)
  : path.join(__dirname, 'data');
require('dotenv').config({ path: path.join(DATA_DIR, '.env') });

const PORT = Number(process.env.PORT || 4100);
// Публичные учётные данные веб-клиента Telegram (те же, с которыми работает
// web.telegram.org). Регистрация приложения в my.telegram.org не требуется.
const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || 'b18441a1ff607e10a989891a5462e627';

const TMP_DIR = path.join(DATA_DIR, 'tmp');
const sessionStore = require('./session');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
for (const dir of [DATA_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

let DAV_USER = process.env.DAV_USER || 'teledrive';
let DAV_PASS = process.env.DAV_PASS || '';
const DAV_INSECURE = process.env.TD_INSECURE_DAV === '1';

// Пароль по умолчанию небезопасен: генерируем случайный и сохраняем в .env.
function persistEnvCreds(user, pass) {
  const envFile = path.join(DATA_DIR, '.env');
  let lines = [];
  try {
    lines = fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  } catch (_) {
    lines = [];
  }
  const out = [];
  let hasUser = false;
  let hasPass = false;
  for (const line of lines) {
    if (/^\s*DAV_USER\s*=/.test(line)) { out.push(`DAV_USER=${user}`); hasUser = true; }
    else if (/^\s*DAV_PASS\s*=/.test(line)) { out.push(`DAV_PASS=${pass}`); hasPass = true; }
    else out.push(line);
  }
  if (!hasUser) out.push(`DAV_USER=${user}`);
  if (!hasPass) out.push(`DAV_PASS=${pass}`);
  fs.writeFileSync(envFile, out.join('\n') + '\n', 'utf8');
}

if (!DAV_INSECURE && (!DAV_PASS || DAV_PASS === 'teledrive')) {
  DAV_PASS = crypto.randomBytes(16).toString('hex');
  persistEnvCreds(DAV_USER, DAV_PASS);
  console.warn('[SECURITY] WebDAV password was default or empty: generated a random one.');
  console.warn(`[SECURITY] DAV_USER=${DAV_USER}; the password is only in .env, not in this log.`);
  console.warn(`[SECURITY] saved to ${path.join(DATA_DIR, '.env')}`);
}
process.env.DAV_USER = DAV_USER;
process.env.DAV_PASS = DAV_PASS;

const DRIVE = process.env.TD_DRIVE || (process.platform === 'win32' ? 'Z:' : 'TGDrive-Easy');
const DRIVE_LABEL = (platform.mountLabel && platform.mountLabel()) || DRIVE;
const MOUNT_MODE = (process.env.MOUNT_MODE || 'webdav').toLowerCase();
const RCLONE_EXE = process.env.RCLONE_EXE || 'C:\\teledrive-stack\\rclone\\rclone-v1.75.2-windows-amd64\\rclone.exe';
const RCLONE_CONF = process.env.RCLONE_CONF || 'C:\\teledrive-stack\\rclone\\rclone.conf';
const PID_FILE = path.join(DATA_DIR, 'server.pid');
const CONTROL_FILE = path.join(DATA_DIR, 'control.token');

let rcloneProc = null;
// rclone rc требует аутентификацию даже на localhost.
const RCLONE_RC_USER = crypto.randomBytes(8).toString('hex');
const RCLONE_RC_PASS = crypto.randomBytes(16).toString('hex');
let mounted = false;

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------
function proxyFromEnv() {
  if (process.env.SOCKS_PROXY === 'off') return { type: 'none' };
  return {
    type: 'socks5',
    host: process.env.SOCKS_IP || '127.0.0.1',
    port: Number(process.env.SOCKS_PORT || 10808),
    user: '',
    pass: '',
    secret: '',
  };
}

function loadSettings() {
  let s = {};
  try {
    // файл могут сохранить редакторы/PowerShell с BOM — срезаем его
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8').replace(/^\uFEFF/, '');
    s = JSON.parse(raw);
  } catch (_) {
    s = {};
  }
  if (typeof s.autoMount !== 'boolean') s.autoMount = true;
  if (typeof s.autoStart !== 'boolean') s.autoStart = false;
  if (!['auto', 'en', 'ru'].includes(s.language)) s.language = 'auto';
  if (!s.proxy || typeof s.proxy !== 'object') s.proxy = proxyFromEnv();
  return s;
}

const settings = loadSettings();

function saveSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (e) {
    console.error('settings save failed:', e.message);
  }
}

// Автозапуск при входе: реализация зависит от платформы.
async function applyAutoStart(enabled) {
  return platform.setAutostart(enabled, { exePath: process.env.TD_APP_EXE });
}

// Параметры прокси для GramJS: SOCKS5 или MTProto (tg://proxy).
function proxyOptions() {
  const p = settings.proxy || { type: 'none' };
  if (p.type === 'none') return undefined;
  if (p.type === 'mtproto') {
    return { ip: p.host, port: Number(p.port), secret: p.secret, MTProxy: true, timeout: 15 };
  }
  const out = { ip: p.host, port: Number(p.port), socksType: 5, timeout: 15 };
  if (p.user) out.username = p.user;
  if (p.pass) out.password = p.pass;
  return out;
}

function proxyLabel() {
  const p = settings.proxy || { type: 'none' };
  if (p.type === 'none') return 'off';
  return `${p.type} ${p.host}:${p.port}`;
}

// ---------------------------------------------------------------------------
// Диск
// ---------------------------------------------------------------------------
// net.exe обращается к нашему же WebDAV-серверу, поэтому синхронный вызов
// заблокировал бы event loop и монтирование «зависло» бы навсегда.
function execAsync(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err) => resolve(!err));
  });
}

function execQuiet(file, args, opts = {}) {
  try {
    execFileSync(file, args, Object.assign({ stdio: 'ignore', timeout: 20000 }, opts));
    return true;
  } catch (_) {
    return false;
  }
}

async function warmDrive() {
  for (let i = 0; i < 15; i++) {
    try {
      await fs.promises.readdir(`${DRIVE}\\`);
      console.log('drive warmed');
      return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('drive warm-up did not finish');
}

async function mountDrive(reason = 'startup') {
  if (mounted) return true;

  if (MOUNT_MODE === 'rclone' && process.platform === 'win32'
      && fs.existsSync(RCLONE_EXE) && fs.existsSync(RCLONE_CONF)) {
    try {
      rcloneProc = spawn(RCLONE_EXE, [
        'mount', 'td:', DRIVE, '--config', RCLONE_CONF,
        '--vfs-cache-mode', 'writes', '--volname', 'TeleDrive',
        '--rc', '--rc-addr', '127.0.0.1:5572', '--rc-user', RCLONE_RC_USER, '--rc-pass', RCLONE_RC_PASS,
        '--log-file', path.join(DATA_DIR, 'rclone.log'), '--log-level', 'INFO', '--no-console',
      ], { stdio: 'ignore' });
      mounted = true;
      console.log(`drive ${DRIVE} mounted via rclone (${reason})`);
      return true;
    } catch (e) {
      console.error('rclone mount failed:', e.message);
    }
  }

  const res = await platform.mount({ drive: DRIVE, port: PORT, user: DAV_USER, pass: DAV_PASS });
  if (res.ok) {
    mounted = true;
    console.log(`drive ${DRIVE_LABEL} mounted (${reason})`);
    if (process.platform === 'win32') warmDrive();
    return true;
  }
  console.log(`drive mount failed: ${res.error || 'unknown error'}`);
  return false;
}

async function unmountDrive() {
  if (!mounted) return false;
  mounted = false;
  if (rcloneProc) {
    execQuiet(RCLONE_EXE, ['rc', '--rc-addr', '127.0.0.1:5572', '--user', RCLONE_RC_USER, '--pass', RCLONE_RC_PASS, 'core/quit']);
    try { rcloneProc.kill(); } catch (_) {}
    rcloneProc = null;
  }
  const res = await platform.unmount({ drive: DRIVE, port: PORT });
  console.log(res.ok ? `drive ${DRIVE_LABEL} unmounted` : `drive ${DRIVE_LABEL} unmount skipped`);
  return res.ok;
}

function shutdown(reason) {
  try { console.log(`shutting down (${reason})`); } catch (_) {}
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
  const finish = () => process.exit(0);
  Promise.resolve(unmountDrive()).finally(finish);
  setTimeout(finish, 4000).unref();
}

process.on('SIGHUP', () => shutdown('console closed'));
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('terminated'));
process.on('exit', () => {
  if (mounted) unmountDrive().catch(() => {});
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Telegram-клиент
// ---------------------------------------------------------------------------
const TOKEN = crypto.randomBytes(16).toString('hex');
// отдельный токен для управления из трея (лежит рядом с данными)
const CONTROL_TOKEN = crypto.randomBytes(8).toString('hex');
fs.writeFileSync(CONTROL_FILE, CONTROL_TOKEN, 'utf8');

let client = null;
let me = null;
let login = null; // { phoneNumber, phoneCodeHash }

async function newClient(session = '') {
  const c = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
    connectionRetries: 3,
    proxy: proxyOptions(),
    useWSS: false,
  });
  await c.connect();
  return c;
}

async function ensureClient() {
  if (client && client.connected) return client;
  const saved = sessionStore.load();
  client = await newClient(saved);
  return client;
}

async function saveSession() {
  sessionStore.save(client.session.save());
}

async function refreshMe() {
  try {
    me = await client.getMe();
    return me;
  } catch (e) {
    me = null;
    return null;
  }
}

function errText(e) {
  return (e && (e.errorMessage || e.message)) || String(e);
}

// Пересоздаёт клиента с новыми настройками прокси. Работает и до входа.
async function applyProxy() {
  try { if (client) await client.disconnect(); } catch (_) {}
  client = null;
  me = null;
  login = null;
  if (!sessionStore.exists()) return { connected: false };
  try {
    await ensureClient();
    await refreshMe();
    return { connected: !!me };
  } catch (e) {
    console.error('proxy apply: reconnect failed:', errText(e));
    return { connected: false, error: errText(e) };
  }
}

// ---------------------------------------------------------------------------
// Описание файла из сообщения
// ---------------------------------------------------------------------------
function describe(m) {
  const date = (m.date || 0) * 1000;
  const media = m.media;
  if (!media) return null;
  const cls = media.className || '';

  // Только настоящие файлы: документы и фотографии.
  if (cls === 'MessageMediaDocument') {
    const doc = media.document;
    if (!doc) return null;
    const size = Number(doc.size || (m.file && m.file.size) || 0);
    const mime = doc.mimeType || (m.file && m.file.mimeType) || '';
    let name = m.file && m.file.name;
    if (!name && Array.isArray(doc.attributes)) {
      const attr = doc.attributes.find((a) => a && a.className === 'DocumentAttributeFilename');
      if (attr) name = attr.fileName;
    }
    if (!name) {
      let ext = mime.includes('/') ? mime.split('/')[1] : 'bin';
      ext = ext.replace('jpeg', 'jpg');
      name = `file_${m.id}.${ext}`;
    }
    return { id: m.id, name, size, mime, date };
  }

  if (cls === 'MessageMediaPhoto') {
    const photo = media.photo;
    if (!photo || !Array.isArray(photo.sizes)) return null;
    let best = 0;
    for (const s of photo.sizes) {
      const sz = Number(s.size || (s.sizes && s.sizes.length ? s.sizes[s.sizes.length - 1] : 0) || 0);
      if (sz > best) best = sz;
    }
    if (best <= 0) return null;
    return { id: m.id, name: `photo_${m.id}.jpg`, size: best, mime: 'image/jpeg', date };
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

function guard(req, res, next) {
  const token = req.get('x-td-token') || req.query.token;
  if (token !== TOKEN) return res.status(403).json({ error: 'invalid token, reload the page' });
  next();
}

function controlGuard(req, res, next) {
  if ((req.get('x-td-control') || '') !== CONTROL_TOKEN) return res.status(403).json({ error: 'forbidden' });
  next();
}

app.get('/ping', (_req, res) => res.json({ pong: true }));

app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html.replace('__TOKEN__', TOKEN));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Сетевой диск: WebDAV поверх «Избранного»
const store = require('./store')({ getClient: ensureClient, describe, dataDir: DATA_DIR, log: (m) => console.error(m) });

function addToIndex(info) {
  if (info && info.size > 0) store.add(info);
}

// Telegram: 2 ГБ на файл, 4 ГБ с Premium.
function maxUploadBytes() {
  const forced = Number(process.env.MAX_UPLOAD_BYTES || 0);
  if (forced > 0) return forced;
  return me && me.premium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
}

app.use('/dav', require('./dav')({
  getClient: ensureClient,
  describe,
  store,
  dataDir: DATA_DIR,
  user: DAV_USER,
  pass: DAV_PASS,
  getMaxUpload: maxUploadBytes,
  log: (msg) => console.error(msg),
}));

// --- состояние и настройки ---
app.get('/api/state', guard, async (req, res) => {
  if (!me) await refreshMe();
  res.json({
    authorized: !!me,
    me: me ? { id: String(me.id), name: [me.firstName, me.lastName].filter(Boolean).join(' '), username: me.username || null } : null,
    mounted,
    autoMount: settings.autoMount,
    proxy: settings.proxy,
  });
});

function resolveLanguage(req) {
  if (settings.language === 'en' || settings.language === 'ru') return settings.language;
  // В режиме auto главнее локаль ОС, а не язык браузера: на русской Windows
  // Edge может отдавать en-US, и интерфейс ошибочно становился английским.
  const os = String(Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
  if (os.startsWith('ru')) return 'ru';
  if (os.startsWith('en')) return 'en';
  const accept = String((req && req.headers && req.headers['accept-language']) || '').toLowerCase();
  const first = accept.split(',')[0].trim();
  if (first.startsWith('ru')) return 'ru';
  if (first.startsWith('en')) return 'en';
  const env = String(process.env.LC_ALL || process.env.LANG || '').toLowerCase();
  if (env.startsWith('ru')) return 'ru';
  return 'en';
}

app.get('/api/settings', guard, (req, res) => {
  res.json({
    autoMount: settings.autoMount,
    autoStart: settings.autoStart,
    canAutoStart: !!process.env.TD_APP_EXE,
    proxy: settings.proxy,
    mounted,
    mode: MOUNT_MODE,
    drive: DRIVE,
    driveLabel: DRIVE_LABEL,
    platform: platform.name,
    mountAvailable: !!platform.mountAvailable,
    language: settings.language,
    effectiveLanguage: resolveLanguage(req),
  });
});

app.post('/api/settings/language', guard, (req, res) => {
  const value = String((req.body && req.body.language) || 'auto');
  if (!['auto', 'en', 'ru'].includes(value)) {
    return res.status(400).json({ error: 'unsupported language' });
  }
  settings.language = value;
  saveSettings();
  res.json({ ok: true, language: value, effectiveLanguage: resolveLanguage(req) });
});

app.post('/api/settings/autostart', guard, async (req, res) => {
  const enabled = !!(req.body && req.body.enabled);
  const result = await applyAutoStart(enabled);
  if (!result.ok) return res.status(400).json({ error: result.error, autoStart: settings.autoStart });
  settings.autoStart = enabled;
  saveSettings();
  res.json({ ok: true, autoStart: settings.autoStart });
});

app.post('/api/settings/auto-mount', guard, (req, res) => {
  settings.autoMount = !!(req.body && req.body.enabled);
  saveSettings();
  res.json({ ok: true, autoMount: settings.autoMount });
});

app.post('/api/settings/proxy', guard, async (req, res) => {
  const b = req.body || {};
  const type = ['none', 'socks5', 'mtproto'].includes(b.type) ? b.type : 'none';
  settings.proxy = {
    type,
    host: String(b.host || '').trim(),
    port: Number(b.port) || 0,
    user: String(b.user || '').trim(),
    pass: String(b.pass || ''),
    secret: String(b.secret || '').trim(),
  };
  saveSettings();
  const result = await applyProxy();
  res.json({ ok: true, proxy: settings.proxy, connected: result.connected, error: result.error });
});

app.post('/api/mount', guard, async (req, res) => {
  const ok = await mountDrive('web');
  res.json({ ok, mounted });
});

app.post('/api/unmount', guard, (req, res) => {
  unmountDrive();
  res.json({ ok: true, mounted });
});

// --- управление из трея ---
app.get('/api/app/status', controlGuard, (req, res) => {
  res.json({ mounted, autoMount: settings.autoMount, mode: MOUNT_MODE });
});

app.post('/api/app/mount', controlGuard, async (req, res) => {
  const ok = await mountDrive('tray');
  res.json({ ok, mounted });
});

app.post('/api/app/unmount', controlGuard, (req, res) => {
  unmountDrive();
  res.json({ ok: true, mounted });
});

// --- авторизация ---
app.post('/api/auth/send-code', guard, async (req, res) => {
  const phone = String((req.body && req.body.phone) || '').trim();
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const c = await ensureClient();
    const out = await c.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    login = { phoneNumber: phone, phoneCodeHash: out.phoneCodeHash };
    res.json({ ok: true, isCodeViaApp: !!out.isCodeViaApp });
  } catch (e) {
    res.status(400).json({ error: errText(e) });
  }
});

app.post('/api/auth/sign-in', guard, async (req, res) => {
  const code = String((req.body && req.body.code) || '').trim();
  if (!login) return res.status(400).json({ error: 'Request a code first' });
  try {
    await client.invoke(new Api.auth.SignIn({
      phoneNumber: login.phoneNumber,
      phoneCodeHash: login.phoneCodeHash,
      phoneCode: code,
    }));
    await saveSession();
    await refreshMe();
    login = null;
    res.json({ ok: true, me });
  } catch (e) {
    if (e && e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
      let hint = '';
      try {
        const p = await client.invoke(new Api.account.GetPassword());
        hint = p.hint || '';
      } catch (_) {}
      return res.json({ needPassword: true, hint });
    }
    res.status(400).json({ error: errText(e) });
  }
});

app.post('/api/auth/password', guard, async (req, res) => {
  const password = String((req.body && req.body.password) || '');
  try {
    await client.signInWithPassword(
      { apiId: API_ID, apiHash: API_HASH },
      { password: async () => password, onError: (e) => { throw e; } }
    );
    await saveSession();
    await refreshMe();
    login = null;
    res.json({ ok: true, me });
  } catch (e) {
    res.status(400).json({ error: errText(e) });
  }
});

app.post('/api/auth/logout', guard, async (req, res) => {
  try {
    if (client) await client.logOut();
  } catch (_) {}
  try { sessionStore.clear(); } catch (_) {}
  me = null;
  login = null;
  res.json({ ok: true });
});

// --- файлы ---
app.get('/api/files', guard, async (req, res) => {
  try {
    if (!me) await refreshMe();
    if (!me) return res.status(401).json({ error: 'not authorized' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    if (req.query.refresh === '1') await store.refresh(true);
    const all = await store.list();
    const items = all.slice(offset, offset + limit);
    const nextOffset = offset + items.length < all.length ? offset + items.length : 0;
    res.json({ items, total: all.length, nextOffset });
  } catch (e) {
    res.status(500).json({ error: errText(e) });
  }
});

app.get('/api/files/:id/download', async (req, res) => {
  if (req.query.token !== TOKEN) return res.status(403).end();
  const id = Number(req.params.id);
  let msg;
  try {
    await ensureClient();
    const found = await client.getMessages('me', { ids: [id] });
    msg = Array.isArray(found) ? found[0] : found;
  } catch (e) {
    return res.status(500).json({ error: errText(e) });
  }
  if (!msg) return res.status(404).end();
  const info = describe(msg);
  if (!info) return res.status(404).end();

  const ascii = info.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', info.mime || 'application/octet-stream');
  if (info.size > 0) res.setHeader('Content-Length', String(info.size));
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(info.name)}`);

  let closed = false;
  res.on('close', () => { closed = true; });

  try {
    const iter = client.iterDownload({ file: msg.media, requestSize: 512 * 1024 });
    for await (const chunk of iter) {
      if (closed) break;
      if (!res.write(chunk)) await once(res, 'drain');
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: errText(e) });
    else res.destroy();
  }
});

const upload = multer({
  storage: multer.diskStorage({
    destination: TMP_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

app.post('/api/upload', guard, upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'no files' });
  const limit = maxUploadBytes();
  const tooBig = files.find((f) => f.size > limit);
  if (tooBig) {
    for (const f of files) fs.unlink(f.path, () => {});
    return res.status(413).json({ error: `File ${tooBig.originalname} exceeds the Telegram limit of ${Math.round(limit / 1073741824)} GB` });
  }
  const uploaded = [];
  try {
    await ensureClient();
    for (const f of files) {
      try {
        const m = await client.sendFile('me', {
          file: f.path,
          forceDocument: true,
          caption: '',
          // сохраняем исходное имя, а не имя временного файла
          attributes: [new Api.DocumentAttributeFilename({ fileName: f.originalname })],
          progressCallback: () => {},
        });
        uploaded.push({ id: m.id, name: f.originalname, size: f.size });
        addToIndex(describe(m));
      } finally {
        fs.unlink(f.path, () => {});
      }
    }
    res.json({ ok: true, uploaded });
  } catch (e) {
    res.status(500).json({ error: errText(e), uploaded });
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.status(400).json({ error: err.message || 'request failed' });
});

// Сервер должен подниматься независимо от доступности Telegram.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`teledrive: http://127.0.0.1:${PORT}  (proxy: ${proxyLabel()}, mode: ${MOUNT_MODE})`);
  try {
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
    fs.writeFileSync(CONTROL_FILE, CONTROL_TOKEN, 'utf8');
  } catch (_) {}
  if (settings.autoMount) {
    mountDrive('startup');
  } else {
    console.log('auto-mount is disabled');
  }
  if (settings.autoStart) {
    applyAutoStart(true)
      .then((r) => console.log(r.ok ? 'autostart entry refreshed' : `autostart entry failed: ${r.error}`))
      .catch((e) => console.log('autostart error:', e.message));
  }
  if (process.stdin.isTTY) {
    console.log('Закройте это окно или нажмите Ctrl+C, чтобы остановить и отмонтировать диск.');
  }
});

(async () => {
  if (sessionStore.exists()) {
    try {
      await ensureClient();
      await refreshMe();
      console.log('session restored');
    } catch (e) {
      console.error('session restore failed:', errText(e));
      me = null;
    }
  }
})();
