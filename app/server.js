'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { once } = require('events');
const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');

const DATA_DIR = process.env.TD_DATA_DIR
  ? path.resolve(process.env.TD_DATA_DIR)
  : path.join(__dirname, 'data');
require('dotenv').config({ path: path.join(DATA_DIR, '.env') });

const PORT = Number(process.env.PORT || 4100);
// РџСѓР±Р»РёС‡РЅС‹Рµ СѓС‡С‘С‚РЅС‹Рµ РґР°РЅРЅС‹Рµ РІРµР±-РєР»РёРµРЅС‚Р° Telegram (С‚Рµ Р¶Рµ, СЃ РєРѕС‚РѕСЂС‹РјРё СЂР°Р±РѕС‚Р°РµС‚
// web.telegram.org). Р РµРіРёСЃС‚СЂР°С†РёСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ РІ my.telegram.org РЅРµ С‚СЂРµР±СѓРµС‚СЃСЏ.
const API_ID = Number(process.env.TG_API_ID || 2040);
const API_HASH = process.env.TG_API_HASH || 'b18441a1ff607e10a989891a5462e627';

const PROXY = process.env.SOCKS_PROXY === 'off'
  ? undefined
  : {
      ip: process.env.SOCKS_IP || '127.0.0.1',
      port: Number(process.env.SOCKS_PORT || 10808),
      socksType: 5,
      timeout: 15,
    };

const TMP_DIR = path.join(DATA_DIR, 'tmp');
const SESSION_FILE = path.join(DATA_DIR, 'session.txt');
for (const dir of [DATA_DIR, TMP_DIR]) fs.mkdirSync(dir, { recursive: true });

const DAV_USER = process.env.DAV_USER || 'teledrive';
const DAV_PASS = process.env.DAV_PASS || 'teledrive';

// Р”РёСЃРє РјРѕРЅС‚РёСЂСѓРµС‚СЃСЏ Рё РґРµРјРѕРЅС‚РёСЂСѓРµС‚СЃСЏ СЃР°РјРёРј СЃРµСЂРІРµСЂРѕРј: Р·Р°РєСЂС‹С‚РёРµ РѕРєРЅР° РєРѕРЅСЃРѕР»Рё
// (SIGHUP) РёР»Рё Ctrl+C СЃРЅРёРјР°РµС‚ РґРёСЃРє, РЅРёС‡РµРіРѕ РЅРµ РѕСЃС‚Р°С‘С‚СЃСЏ В«РІРёСЃРµС‚СЊВ».
const { execFileSync, spawn } = require('child_process');
const DRIVE = process.env.TD_DRIVE || 'Z:';
const MOUNT_MODE = (process.env.MOUNT_MODE || 'webdav').toLowerCase();
const RCLONE_EXE = process.env.RCLONE_EXE || 'C:\\teledrive-stack\\rclone\\rclone-v1.75.2-windows-amd64\\rclone.exe';
const RCLONE_CONF = process.env.RCLONE_CONF || 'C:\\teledrive-stack\\rclone\\rclone.conf';
let rcloneProc = null;
let mounted = false;
const PID_FILE = path.join(DATA_DIR, 'server.pid');

function execQuiet(file, args, opts = {}) {
  try {
    execFileSync(file, args, Object.assign({ stdio: 'ignore', timeout: 20000 }, opts));
    return true;
  } catch (_) {
    return false;
  }
}

async function mountDrive() {
  if (mounted) return;
  if (MOUNT_MODE === 'rclone' && fs.existsSync(RCLONE_EXE) && fs.existsSync(RCLONE_CONF)) {
    try {
      rcloneProc = spawn(RCLONE_EXE, [
        'mount', 'td:', DRIVE, '--config', RCLONE_CONF,
        '--vfs-cache-mode', 'writes', '--volname', 'TeleDrive',
        '--rc', '--rc-no-auth', '--rc-addr', '127.0.0.1:5572',
        '--log-file', 'C:\\teledrive-stack\\logs\\rclone.log', '--log-level', 'INFO', '--no-console',
      ], { stdio: 'ignore' });
      mounted = true;
      console.log(`drive ${DRIVE} mounted via rclone`);
      return;
    } catch (e) {
      console.error('rclone mount failed:', e.message);
    }
  }
  // РЎР»СѓР¶Р±Р° WebClient РёРЅРѕРіРґР° Р·Р°РїСѓСЃРєР°РµС‚СЃСЏ СЃ РїРµСЂРІРѕРіРѕ СЂР°Р·Р° РЅРµ СЃСЂР°Р·Сѓ вЂ” РїСЂРѕР±СѓРµРј РµС‰С‘.
  const mountArgs = [
    'use', DRIVE, `http://localhost:${PORT}/dav`,
    `/user:${DAV_USER}`, DAV_PASS, '/persistent:no',
  ];
  for (let attempt = 1; attempt <= 10; attempt++) {
    let ok = execQuiet('net.exe', mountArgs);
    if (!ok) {
      // В«Р·Р°Р»РёРїС€РµРµВ» РїРѕРґРєР»СЋС‡РµРЅРёРµ РѕС‚ РїСЂРѕС€Р»РѕРіРѕ Р·Р°РїСѓСЃРєР° РјРµС€Р°РµС‚ вЂ” СЃРЅРёРјР°РµРј Рё РїСЂРѕР±СѓРµРј СЃРЅРѕРІР°
      execQuiet('net.exe', ['use', DRIVE, '/delete', '/y']);
      ok = execQuiet('net.exe', mountArgs);
    }
    if (ok) {
      mounted = true;
      console.log(`drive ${DRIVE} mounted`);
      warmDrive();
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`drive ${DRIVE} is not mounted (busy or webdav unavailable)`);
}

// РџРµСЂРІРѕРµ РѕР±СЂР°С‰РµРЅРёРµ Рє С‚РѕР»СЊРєРѕ С‡С‚Рѕ СЃРјРѕРЅС‚РёСЂРѕРІР°РЅРЅРѕРјСѓ WebDAV-РґРёСЃРєСѓ С‡Р°СЃС‚Рѕ РїР°РґР°РµС‚,
// РїРѕРєР° СЃР»СѓР¶Р±Р° WebClient РЅРµ В«РїСЂРѕРіСЂРµРµС‚СЃСЏВ». Р§РёС‚Р°РµРј РґРёСЃРє РЅРµСЃРєРѕР»СЊРєРѕ СЂР°Р·.
async function warmDrive() {
  for (let i = 0; i < 15; i++) {
    try {
      fs.readdirSync(`${DRIVE}\\`);
      console.log('drive warmed');
      return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('drive warm-up did not finish');
}

function unmountDrive() {  if (!mounted) return;
  mounted = false;
  if (rcloneProc) {
    execQuiet(RCLONE_EXE, ['rc', '--rc-addr', '127.0.0.1:5572', 'core/quit']);
    try { rcloneProc.kill(); } catch (_) {}
    rcloneProc = null;
  }
  const ok = execQuiet('net.exe', ['use', DRIVE, '/delete', '/y']);
  console.log(ok ? `drive ${DRIVE} unmounted` : `drive ${DRIVE} unmount skipped`);
}

function shutdown(reason) {
  try { console.log(`shutting down (${reason})`); } catch (_) {}
  unmountDrive();
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
  process.exit(0);
}

process.on('SIGHUP', () => shutdown('console closed'));
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('terminated'));
process.on('exit', () => {
  if (mounted) unmountDrive();
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
});

// РћРґРЅРѕСЂР°Р·РѕРІС‹Р№ С‚РѕРєРµРЅ РЅР° РїСЂРѕС†РµСЃСЃ: Р·Р°С‰РёС‰Р°РµС‚ Р»РѕРєР°Р»СЊРЅС‹Р№ API РѕС‚ РѕР±СЂР°С‰РµРЅРёР№ С‡СѓР¶РёС… СЃР°Р№С‚РѕРІ.
const TOKEN = crypto.randomBytes(16).toString('hex');

let client = null;
let me = null;
let login = null; // { phoneNumber, phoneCodeHash }

async function newClient(session = '') {
  const c = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
    connectionRetries: 3,
    proxy: PROXY,
    useWSS: false,
  });
  await c.connect();
  return c;
}

async function ensureClient() {
  if (client && client.connected) return client;
  const saved = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';
  client = await newClient(saved);
  return client;
}

async function saveSession() {
  fs.writeFileSync(SESSION_FILE, client.session.save(), 'utf8');
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

// ---------------------------------------------------------------------------
// РћРїРёСЃР°РЅРёРµ С„Р°Р№Р»Р° РёР· СЃРѕРѕР±С‰РµРЅРёСЏ
// ---------------------------------------------------------------------------
function describe(m) {
  const date = (m.date || 0) * 1000;
  const media = m.media;
  if (!media) return null;
  const cls = media.className || '';

  // РўРѕР»СЊРєРѕ РЅР°СЃС‚РѕСЏС‰РёРµ С„Р°Р№Р»С‹: РґРѕРєСѓРјРµРЅС‚С‹ Рё С„РѕС‚РѕРіСЂР°С„РёРё.
  // Р’РµР±-СЃС‚СЂР°РЅРёС†С‹ СЃ РїСЂРµРІСЊСЋ, РіРµРѕР»РѕРєР°С†РёРё Рё РїСЂРѕС‡РµРµ РїСЂРѕРїСѓСЃРєР°РµРј.
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

app.get('/', (req, res) => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html.replace('__TOKEN__', TOKEN));
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// РЎРµС‚РµРІРѕР№ РґРёСЃРє: WebDAV РїРѕРІРµСЂС… В«РР·Р±СЂР°РЅРЅРѕРіРѕВ»
const store = require('./store')({ getClient: ensureClient, describe, dataDir: DATA_DIR, log: (m) => console.error(m) });

function addToIndex(info) {
  if (info && info.size > 0) store.add(info);
}

// Telegram: 2 Р“Р‘ РЅР° С„Р°Р№Р», 4 Р“Р‘ СЃ Premium.
// MAX_UPLOAD_BYTES РІ .env РїРµСЂРµРѕРїСЂРµРґРµР»СЏРµС‚ Р»РёРјРёС‚ (РЅР°РїСЂРёРјРµСЂ, РґР»СЏ РїСЂРѕРІРµСЂРєРё РїРѕРІРµРґРµРЅРёСЏ).
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

app.get('/api/state', guard, async (req, res) => {
  if (!me) await refreshMe();
  res.json({ authorized: !!me, me: me ? { id: String(me.id), name: [me.firstName, me.lastName].filter(Boolean).join(' '), username: me.username || null } : null });
});

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
      {
        password: async () => password,
        onError: (e) => { throw e; },
      }
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
  try { fs.unlinkSync(SESSION_FILE); } catch (_) {}
  me = null;
  login = null;
  res.json({ ok: true });
});

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
          // СЃРѕС…СЂР°РЅСЏРµРј РёСЃС…РѕРґРЅРѕРµ РёРјСЏ С„Р°Р№Р»Р°, Р° РЅРµ РёРјСЏ РІСЂРµРјРµРЅРЅРѕРіРѕ С„Р°Р№Р»Р°
          attributes: [new Api.DocumentAttributeFilename({ fileName: f.originalname })],
          progressCallback: () => {},
        });
        uploaded.push({ id: m.id, name: f.originalname, size: f.size });
        const info = describe(m);
        addToIndex(info);
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

// РЎРµСЂРІРµСЂ РґРѕР»Р¶РµРЅ РїРѕРґРЅРёРјР°С‚СЊСЃСЏ РЅРµР·Р°РІРёСЃРёРјРѕ РѕС‚ РґРѕСЃС‚СѓРїРЅРѕСЃС‚Рё Telegram:
// РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ СЃРµСЃСЃРёРё РёРґС‘С‚ РІ С„РѕРЅРµ, РёРЅР°С‡Рµ РїСЂРё РЅРµРґРѕСЃС‚СѓРїРЅРѕРј РїСЂРѕРєСЃРё
// РїРѕСЂС‚ РЅРµ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ Рё РїСЂРёР»РѕР¶РµРЅРёРµ РІС‹РіР»СЏРґРёС‚ В«РјС‘СЂС‚РІС‹РјВ».
app.listen(PORT, '127.0.0.1', () => {
  console.log(`teledrive-mine: http://127.0.0.1:${PORT}  (proxy: ${PROXY ? PROXY.ip + ':' + PROXY.port : 'off'}, mode: ${MOUNT_MODE})`);
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  } catch (_) {}
  mountDrive();
  if (process.stdin.isTTY) {
    console.log('Р—Р°РєСЂРѕР№С‚Рµ СЌС‚Рѕ РѕРєРЅРѕ РёР»Рё РЅР°Р¶РјРёС‚Рµ Ctrl+C, С‡С‚РѕР±С‹ РѕСЃС‚Р°РЅРѕРІРёС‚СЊ Рё РѕС‚РјРѕРЅС‚РёСЂРѕРІР°С‚СЊ РґРёСЃРє.');
  }
});

(async () => {
  if (fs.existsSync(SESSION_FILE)) {
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


