'use strict';

// Minimal WebDAV server on top of Telegram Saved Messages.
// Methods: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, LOCK, UNLOCK, PROPPATCH.
// Folders are virtual (data/tree.json); files are Telegram messages.

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { Api } = require('telegram');

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function httpDate(ms) {
  return new Date(ms || Date.now()).toUTCString();
}

function normPath(p) {
  let s = ('/' + p).replace(/\/+/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function parentOf(p) {
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

function baseOf(p) {
  return p.slice(p.lastIndexOf('/') + 1);
}

function joinPath(dir, name) {
  return dir === '/' ? '/' + name : dir + '/' + name;
}

function hrefOf(p, isDir) {
  const enc = p.split('/').map((s) => encodeURIComponent(s)).join('/');
  return '/dav' + enc + (isDir && !enc.endsWith('/') ? '/' : '');
}

function safeDecode(p) {
  try {
    return decodeURIComponent(p);
  } catch (_) {
    return p;
  }
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', txt: 'text/plain', zip: 'application/zip',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  apk: 'application/vnd.android.package-archive', epub: 'application/epub+zip',
};

function guessMime(name) {
  const ext = (String(name).split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

module.exports = function createDavRouter({ getClient, describe, store, dataDir, user, pass, log, getMaxUpload }) {
  const router = express.Router();
  const TREE_FILE = path.join(dataDir, 'tree.json');
  const TMP_DIR = path.join(dataDir, 'tmp');
  fs.mkdirSync(TMP_DIR, { recursive: true });
  // при старте временные файлы — это остатки прерванных загрузок
  try {
    for (const f of fs.readdirSync(TMP_DIR)) {
      try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch (_) {}
    }
  } catch (_) {}

  const locks = new Map();
  // Загрузки в Telegram выполняем по одной: параллельные sendFile на одном
  // клиенте GramJS зависают без ошибки.
  let uploadQueue = Promise.resolve();

  function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
    ]).finally(() => clearTimeout(timer));
  }

  function loadTree() {
    try {
      const t = JSON.parse(fs.readFileSync(TREE_FILE, 'utf8'));
      if (!Array.isArray(t.folders)) t.folders = ['/'];
      if (!t.files || typeof t.files !== 'object') t.files = {};
      return t;
    } catch (_) {
      return { folders: ['/'], files: {} };
    }
  }

  function saveTree(tree) {
    fs.writeFileSync(TREE_FILE, JSON.stringify(tree, null, 2), 'utf8');
  }

  // Заметка об ошибке прямо в папке: пользователь видит её в Проводнике.
  function addFailureNote(p, name, size, reason) {
    const tree = loadTree();
    const dir = parentOf(p);
    const noteName = `${name}.upload-failed.txt`;
    const notePath = joinPath(dir, noteName);
    const content = [
      'Upload failed',
      '',
      `File:   ${name}`,
      `Size:   ${size} bytes`,
      `Time:   ${new Date().toISOString()}`,
      `Reason: ${reason}`,
      '',
      'The file was NOT stored in Telegram. Copy it again to retry.',
      'Delete this note when you have read it.',
    ].join('\r\n');
    tree.files['virtual:' + notePath] = {
      virtual: true, folder: dir, name: noteName, content, at: Date.now(),
    };
    saveTree(tree);
    log && log(`note created: ${notePath}`);
  }

  // На старте «pending» без процесса загрузки — это прерванные копирования.
  function cleanupInterruptedUploads() {
    const tree = loadTree();
    const stale = Object.keys(tree.files).filter((k) => k.startsWith('pending:'));
    if (!stale.length) return;
    for (const key of stale) {
      const meta = tree.files[key];
      const p = key.slice('pending:'.length);
      delete tree.files[key];
      const dir = meta.folder || '/';
      const noteName = `${meta.name}.upload-failed.txt`;
      const notePath = joinPath(dir, noteName);
      tree.files['virtual:' + notePath] = {
        virtual: true,
        folder: dir,
        name: noteName,
        at: Date.now(),
        content: [
          'Upload interrupted',
          '',
          `File:   ${meta.name}`,
          `Size:   ${meta.size || 0} bytes`,
          `Time:   ${new Date().toISOString()}`,
          'Reason: the application was stopped before the upload finished.',
          '',
          'The file was NOT stored in Telegram. Copy it again to retry.',
        ].join('\r\n'),
      };
    }
    saveTree(tree);
    log && log(`cleanup: ${stale.length} interrupted upload(s) marked as failed`);
  }

  const metaOf = (tree, item) => tree.files[String(item.id)] || {};
  const nameOf = (tree, item) => metaOf(tree, item).name || item.name;
  const folderOf = (tree, item) => metaOf(tree, item).folder || '/';

  async function entries(dir) {
    const tree = loadTree();
    const all = await store.list();
    const dirs = [...new Set(tree.folders)].filter((f) => f !== '/' && parentOf(f) === dir).sort();
    const used = new Set(dirs.map((d) => baseOf(d)));
    const files = [];
    for (const it of all) {
      if (folderOf(tree, it) !== dir) continue;
      let name = nameOf(tree, it);
      if (used.has(name)) {
// Telegram allows duplicate names - add a suffix, otherwise Explorer collapses them.
        const ext = path.extname(name);
        const base = name.slice(0, name.length - ext.length) || name;
        let i = 2;
        while (used.has(`${base} (${i})${ext}`)) i++;
        name = `${base} (${i})${ext}`;
      }
      used.add(name);
      files.push({ kind: 'file', path: joinPath(dir, name), item: it, name });
    }
// "Pending" files that Windows creates before sending the data.
    for (const [key, meta] of Object.entries(tree.files)) {
      if (!key.startsWith('pending:') || meta.folder !== dir) continue;
      files.push({
        kind: 'file',
        path: joinPath(dir, meta.name),
        name: meta.name,
        item: {
          id: null,
          name: meta.name,
          size: Number(meta.size || 0),
          mime: meta.mime || 'application/octet-stream',
          date: meta.at || Date.now(),
        },
      });
    }
    // Заметки об ошибках загрузки (виртуальные файлы, только локально)
    for (const [key, meta] of Object.entries(tree.files)) {
      if (!key.startsWith('virtual:') || meta.folder !== dir) continue;
      const content = meta.content || '';
      files.push({
        kind: 'file',
        path: joinPath(dir, meta.name),
        name: meta.name,
        item: {
          id: null,
          virtual: true,
          content,
          name: meta.name,
          size: Buffer.byteLength(content),
          mime: 'text/plain; charset=utf-8',
          date: meta.at || Date.now(),
        },
      });
    }

    return { tree, all, children: [...dirs.map((d) => ({ kind: 'dir', path: d, name: baseOf(d) })), ...files] };
  }

  async function findFile(p) {
    const dir = parentOf(p);
    const { tree, children } = await entries(dir);
    const found = children.find((c) => c.kind === 'file' && c.path === p);
    return found ? { item: found.item, tree } : null;
  }

  // Windows показывает у WebDAV-диска объём локального тома, если сервер не
  // присылает квоту (RFC 4331). Отдаём «облачный» объём: 1 ПиБ свободно.
  const QUOTA_AVAILABLE = 1125899906842624n; // 1 PiB

  function propstatBlock(href, name, isDir, size, mime, mtime, quota) {
    const type = isDir ? '<D:resourcetype><D:collection/></D:resourcetype>' : '<D:resourcetype/>';
    const extra = isDir
      ? '<D:quota-available-bytes>' + QUOTA_AVAILABLE + '</D:quota-available-bytes>' +
        '<D:quota-used-bytes>' + ((quota && quota.used) || 0) + '</D:quota-used-bytes>'
      : `<D:getcontentlength>${size}</D:getcontentlength>` +
        `<D:getcontenttype>${xmlEscape(mime || 'application/octet-stream')}</D:getcontenttype>`;
    return (
      '<D:response>' +
      `<D:href>${xmlEscape(href)}</D:href>` +
      '<D:propstat><D:prop>' +
      `<D:displayname>${xmlEscape(name)}</D:displayname>` +
      type + extra +
      `<D:getlastmodified>${httpDate(mtime)}</D:getlastmodified>` +
      `<D:creationdate>${new Date(mtime || Date.now()).toISOString()}</D:creationdate>` +
      '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope>' +
      '<D:locktype><D:write/></D:locktype></D:lockentry></D:supportedlock>' +
      '<D:lockdiscovery/>' +
      '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>' +
      '</D:response>'
    );
  }

// ---------------- methods ----------------

  async function onOptions(req, res) {
    res.setHeader('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, LOCK, UNLOCK');
    res.setHeader('Content-Length', '0');
    res.status(200).end();
  }

  async function onPropfind(req, res) {
    const p = normPath(safeDecode(req.path));
    const tree = loadTree();
    const all = await store.list();
    const usedBytes = all.reduce((sum, it) => sum + (it.size || 0), 0);
    const quota = { used: usedBytes };
    const body = [];
    if (p === '/' || tree.folders.includes(p)) {
      body.push(propstatBlock(hrefOf(p, true), baseOf(p) || 'dav', true, 0, '', Date.now(), quota));
      if ((req.headers.depth || '1') !== '0') {
        const { children } = await entries(p);
        for (const c of children) {
          if (c.kind === 'dir') body.push(propstatBlock(hrefOf(c.path, true), c.name, true, 0, '', Date.now(), quota));
          else body.push(propstatBlock(hrefOf(c.path, false), c.name, false, c.item.size, c.item.mime, c.item.date));
        }
      }
    } else {
      const found = await findFile(p);
      if (!found) return res.status(404).type('text/plain').send('Not found');
      body.push(propstatBlock(hrefOf(p, false), baseOf(p), false, found.item.size, found.item.mime, found.item.date));
    }
    const xml = XML_HEAD + '<D:multistatus xmlns:D="DAV:">' + body.join('') + '</D:multistatus>';
    res.status(207)
      .setHeader('Content-Type', 'application/xml; charset=utf-8')
      .setHeader('Content-Length', String(Buffer.byteLength(xml)))
      .end(xml);
  }

  async function streamFile(req, res) {
    const p = normPath(safeDecode(req.path));
    const found = await findFile(p);
    if (!found) return res.status(404).type('text/plain').send('Not found');
    const { item } = found;
    if (item.virtual) {
      const body = item.content || '';
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Length', String(Buffer.byteLength(body)));
      res.setHeader('Content-Disposition', `attachment; filename="${item.name.replace(/"/g, '_')}"`);
      return res.status(200).end(req.method === 'HEAD' ? undefined : body);
    }
    if (!item.id) {
      res.setHeader('Content-Type', item.mime || 'application/octet-stream');
      res.setHeader('Content-Length', '0');
      return res.status(200).end();
    }
    const client = await getClient();
    const msgs = await client.getMessages('me', { ids: [item.id] });
    const msg = Array.isArray(msgs) ? msgs[0] : msgs;
    if (!msg) return res.status(404).type('text/plain').send('Not found');

    const ascii = item.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', item.mime || 'application/octet-stream');
    if (item.size > 0) res.setHeader('Content-Length', String(item.size));
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(item.name)}`);
    res.setHeader('Last-Modified', httpDate(item.date));

    if (req.method === 'HEAD') return res.end();

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
      if (!res.headersSent) res.status(500).end(String(e.message || e));
      else res.destroy();
    }
  }

  async function onGet(req, res) {
    const p = normPath(safeDecode(req.path));
    if (p === '/' || loadTree().folders.includes(p)) return res.status(405).type('text/plain').send('Is a collection');
    await streamFile(req, res);
  }

  async function onPut(req, res) {
    const p = normPath(safeDecode(req.path));
    const dir = parentOf(p);
    const name = baseOf(p);
    const tree = loadTree();
    if (dir !== '/' && !tree.folders.includes(dir)) return res.status(409).type('text/plain').send('Parent missing');

    // Отсекаем слишком большие файлы до передачи данных: иначе Проводник
    // сначала зальёт весь файл, а упадёт только на стороне Telegram.
    const declared = Number(req.headers['content-length'] || 0);
    const maxBytes = getMaxUpload ? getMaxUpload() : 0;
    if (maxBytes && declared > maxBytes) {
      req.resume();
      const sizeText = declared >= 1073741824
        ? `${(declared / 1073741824).toFixed(1)} GB`
        : `${Math.round(declared / 1048576)} MB`;
      const limitText = maxBytes >= 1073741824
        ? `${Math.round(maxBytes / 1073741824)} GB`
        : `${Math.round(maxBytes / 1048576)} MB`;
      log && log(`PUT rejected: ${name} is ${sizeText}, limit ${limitText}`);
      // сообщение латиницей: rclone пишет его в лог, кириллица там ломается
      return res.status(413)
        .type('text/plain; charset=utf-8')
        .send(`File too large: ${sizeText}, Telegram limit is ${limitText} per file.`);
    }

    const tmp = path.join(TMP_DIR, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tmp);
        let settled = false;
        const done = (err) => {
          if (settled) return;
          settled = true;
          if (err) reject(err); else resolve();
        };
        ws.on('finish', () => done());
        ws.on('error', (err) => done(err));
        // клиент оборвал соединение посреди передачи
        req.on('aborted', () => {
          ws.destroy();
          done(new Error('connection aborted by client'));
        });
        req.on('error', (err) => done(err));
        req.pipe(ws);
      });
      const stored = fs.statSync(tmp).size;
      if (process.env.DAV_DEBUG === '1') log && log(`PUT body ${name}: ${stored} bytes`);

      // «пустой» PUT: Windows создаёт файл перед записью данных
      if (stored === 0) {
        const fresh = loadTree();
        fresh.files['pending:' + p] = { folder: dir, name, pending: true, size: 0, at: Date.now() };
        saveTree(fresh);
        fs.unlink(tmp, () => {});
        return res.status(201).setHeader('Content-Length', '0').end();
      }

      // Отвечаем сразу, а в Telegram загружаем в фоне: клиент Windows
      // обрывает PUT примерно через 60 секунд ожидания ответа, а загрузка
      // большого файла через прокси идёт дольше.
      const fresh = loadTree();
      fresh.files['pending:' + p] = {
        folder: dir, name, pending: true, size: stored, mime: guessMime(name), at: Date.now(),
      };
      delete fresh.files['virtual:' + p];
      saveTree(fresh);
      res.status(201).setHeader('Content-Length', '0').end();
      uploadQueue = uploadQueue
        .then(() => uploadInBackground(tmp, p, dir, name, stored))
        .catch((err) => log && log('upload queue error: ' + (err && err.message || err)));
    } catch (e) {
      const text = (e && (e.errorMessage || e.message)) || String(e);
      log && log(`PUT error (${name}): ` + text);
      fs.unlink(tmp, () => {});
      if (res.headersSent) return;
      if (/FILE_PART_TOO_BIG|FILE_TOO_BIG|TOO_BIG/i.test(text)) {
        return res.status(413).type('text/plain; charset=utf-8').send('File too large for Telegram.');
      }
      res.status(500).type('text/plain').send('Error: ' + text);
    }
  }

  async function uploadInBackground(tmp, p, dir, name, size) {
    try {
      log && log(`upload start: ${name} (${size} bytes)`);
      // Управляемый сбой для тестов устойчивости: TD_FAIL_UPLOAD=1
      if (process.env.TD_FAIL_UPLOAD === '1') {
        throw new Error('simulated upload failure (TD_FAIL_UPLOAD=1)');
      }
      const client = await withTimeout(getClient(), 90 * 1000, 'Telegram connection timeout');
      log && log(`upload client ready: ${name}`);
      const msg = await withTimeout(
        client.sendFile('me', {
          file: tmp,
          forceDocument: true,
          caption: '',
          attributes: [new Api.DocumentAttributeFilename({ fileName: name })],
          progressCallback: () => {},
        }),
        45 * 60 * 1000,
        'upload timeout (45 min)'
      );
      const tree2 = loadTree();
      // файл успели удалить, пока он загружался
      if (!tree2.files['pending:' + p]) {
        try { await client.deleteMessages('me', [msg.id], { revoke: true }); } catch (_) {}
        return;
      }
      delete tree2.files['pending:' + p];
      const duplicate = Object.entries(tree2.files).find(([, m]) => m.folder === dir && m.name === name);
      if (duplicate) delete tree2.files[duplicate[0]];
      tree2.files[String(msg.id)] = { folder: dir, name };
      saveTree(tree2);
      const info = describe(msg);
      if (info && info.size > 0) store.add(info);
      log && log(`PUT stored: ${name} (${msg.id})`);
    } catch (e) {
      const text = (e && (e.errorMessage || e.message)) || String(e);
      log && log(`PUT upload failed: ${name}: ${text}`);
      const tree2 = loadTree();
      delete tree2.files['pending:' + p];
      saveTree(tree2);
      addFailureNote(p, name, size, text);
    } finally {
      fs.unlink(tmp, () => {});
    }
  }

  function removeFolderSubtree(tree, dir) {
    const prefix = dir + '/';
    tree.folders = tree.folders.filter((f) => f !== dir && !f.startsWith(prefix));
    for (const [id, meta] of Object.entries(tree.files)) {
      if (meta.folder === dir || (meta.folder || '').startsWith(prefix)) delete tree.files[id];
    }
  }

  async function onDelete(req, res) {
    const p = normPath(safeDecode(req.path));
    const tree = loadTree();
    if (p === '/') return res.status(403).end();
    if (tree.folders.includes(p)) {
      removeFolderSubtree(tree, p);
      saveTree(tree);
      return res.status(204).end();
    }
    const found = await findFile(p);
    if (!found) return res.status(404).end();
    if (found.item.virtual) {
      delete tree.files['virtual:' + p];
      saveTree(tree);
      return res.status(204).end();
    }
    if (!found.item.id) {
      delete tree.files['pending:' + p];
      saveTree(tree);
      return res.status(204).end();
    }
    const client = await getClient();
    await client.deleteMessages('me', [found.item.id], { revoke: true });
    delete tree.files[String(found.item.id)];
    saveTree(tree);
    store.remove(found.item.id);
    res.status(204).end();
  }

  async function onMkcol(req, res) {
    const p = normPath(safeDecode(req.path));
    const tree = loadTree();
    if (tree.folders.includes(p)) return res.status(405).end();
    const parent = parentOf(p);
    if (parent !== '/' && !tree.folders.includes(parent)) return res.status(409).end();
    tree.folders.push(p);
    saveTree(tree);
    res.status(201).setHeader('Content-Length', '0').end();
  }

  async function onMove(req, res) {
    const src = normPath(safeDecode(req.path));
    let destPath;
    try {
      const u = new URL(req.headers.destination || '', 'http://localhost');
      destPath = normPath(safeDecode(u.pathname.replace(/^\/dav/, '')));
    } catch (_) {
      return res.status(400).end();
    }
    const tree = loadTree();
    if (tree.folders.includes(src)) {
      if (tree.folders.includes(destPath)) return res.status(409).end();
      const prefix = src + '/';
      tree.folders = tree.folders.map((f) => (f === src ? destPath : f.startsWith(prefix) ? destPath + f.slice(src.length) : f));
      for (const meta of Object.values(tree.files)) {
        if (meta.folder === src) meta.folder = destPath;
        else if ((meta.folder || '').startsWith(prefix)) meta.folder = destPath + meta.folder.slice(src.length);
      }
      saveTree(tree);
      return res.status(201).setHeader('Content-Length', '0').end();
    }
    const found = await findFile(src);
    if (!found) return res.status(404).end();
    const destDir = parentOf(destPath);
    if (destDir !== '/' && !tree.folders.includes(destDir)) return res.status(409).end();
    tree.files[String(found.item.id)] = { folder: destDir, name: baseOf(destPath) };
    saveTree(tree);
    res.status(201).setHeader('Content-Length', '0').end();
  }

  const lockXml = (p, token) =>
    XML_HEAD +
    '<D:prop xmlns:D="DAV:"><D:lockdiscovery><D:activelock>' +
    '<D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/></D:lockscope>' +
    '<D:depth>infinity</D:depth><D:owner></D:owner><D:timeout>Second-3600</D:timeout>' +
    `<D:locktoken><D:href>${token}</D:href></D:locktoken>` +
    `<D:lockroot><D:href>${xmlEscape(hrefOf(p, false))}</D:href></D:lockroot>` +
    '</D:activelock></D:lockdiscovery></D:prop>';

  async function onLock(req, res) {
    const p = normPath(safeDecode(req.path));
    const token = 'opaquelocktoken:' + crypto.randomUUID();
    locks.set(token, p);
    res.status(200)
      .setHeader('Lock-Token', `<${token}>`)
      .setHeader('Content-Type', 'application/xml; charset=utf-8')
      .end(lockXml(p, token));
  }

  async function onUnlock(req, res) {
    const token = (req.headers['lock-token'] || '').replace(/[<>]/g, '');
    locks.delete(token);
    res.status(204).end();
  }

  async function onProppatch(req, res) {
    const p = normPath(safeDecode(req.path));
    const xml = XML_HEAD + '<D:multistatus xmlns:D="DAV:"><D:response>' +
      `<D:href>${xmlEscape(hrefOf(p, false))}</D:href>` +
      '<D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat>' +
      '</D:response></D:multistatus>';
    res.status(207).setHeader('Content-Type', 'application/xml; charset=utf-8').end(xml);
  }

// --- Basic auth ---
  router.use((req, res, next) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const raw = Buffer.from(h.slice(6), 'base64').toString('utf8');
      const idx = raw.indexOf(':');
      if (idx > 0 && raw.slice(0, idx) === user && raw.slice(idx + 1) === pass) return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="teledrive"');
    res.status(401).type('text/plain').send('Authentication required');
  });

  router.all('*', async (req, res) => {
    res.setHeader('DAV', '1,2');
    res.setHeader('MS-Author-Via', 'DAV');
    res.setHeader('Server', 'teledrive-local');
    if (process.env.DAV_DEBUG === '1') {
      log && log(`DAV ${req.method} ${req.url} len=${req.headers['content-length']} te=${req.headers['transfer-encoding']} ct=${req.headers['content-type']} expect=${req.headers.expect}`);
    }
    const handlers = {
      OPTIONS: onOptions,
      PROPFIND: onPropfind,
      GET: onGet,
      HEAD: streamFile,
      PUT: onPut,
      DELETE: onDelete,
      MKCOL: onMkcol,
      MOVE: onMove,
      LOCK: onLock,
      UNLOCK: onUnlock,
      PROPPATCH: onProppatch,
    };
    const handler = handlers[req.method];
    if (!handler) {
      req.resume();
      return res.status(405).type('text/plain').send('Method not allowed');
    }
    if (req.method !== 'PUT') req.resume();
    try {
      await handler(req, res);
    } catch (e) {
      log && log('DAV ' + req.method + ' error: ' + (e.message || e));
      if (!res.headersSent) res.status(500).type('text/plain').send('Error: ' + (e.message || e));
      else res.destroy();
    }
  });

  cleanupInterruptedUploads();

  return router;
};

