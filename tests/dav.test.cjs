'use strict';

// Тесты устойчивости WebDAV-слоя. Запуск: node tests\dav.test.cjs
// Требует работающий сервер на 127.0.0.1:4100 и живой прокси к Telegram.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.TD_PORT || 4100);
const davCredentials = () => {
  const candidates = [
    path.join(process.env.APPDATA || '', 'TGDrive-Easy', 'data', '.env'),
    path.join(__dirname, '..', 'data', '.env'),
  ];
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const user = (text.match(/^DAV_USER=(.*)$/m) || [])[1];
      const pass = (text.match(/^DAV_PASS=(.*)$/m) || [])[1];
      if (pass) return { user: (user || 'teledrive').trim(), pass: pass.trim() };
    } catch (_) {}
  }
  return { user: 'teledrive', pass: 'teledrive' };
};
const DAV = davCredentials();
const AUTH = 'Basic ' + Buffer.from(DAV.user + ':' + DAV.pass).toString('base64');
const TMP_DIR = path.join(__dirname, '..', 'data', 'tmp');

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function request(method, urlPath, { body, headers = {}, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: urlPath,
        method,
        headers: Object.assign({ authorization: AUTH }, headers),
        timeout,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          ms: Date.now() - started,
        }));
      }
    );
    req.on('timeout', () => req.destroy(new Error('client timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForFile(name, attempt = 0) {
  const res = await request('GET', '/dav/' + encodeURIComponent(name));
  if (res.status === 200 && res.body.length > 0) return res;
  if (attempt > 60) return res;
  await sleep(2000);
  return waitForFile(name, attempt + 1);
}

async function deleteIfExists(name) {
  try { await request('DELETE', '/dav/' + encodeURIComponent(name)); } catch (_) {}
}

// Убираем оставшиеся от прежних прогонов заметки об ошибках
async function cleanupNotes() {
  try {
    const listing = await request('PROPFIND', '/dav/', { headers: { depth: '1' } });
    const xml = listing.body.toString('utf8');
    const hrefs = [...xml.matchAll(/<D:href>(\/dav\/[^<]*upload-failed\.txt)<\/D:href>/g)].map((m) => m[1]);
    for (const href of hrefs) await request('DELETE', href).catch(() => {});
    if (hrefs.length) console.log(`  (удалено заметок: ${hrefs.length})`);
  } catch (_) {}
}

function tmpCount() {
  try { return fs.readdirSync(TMP_DIR).length; } catch (_) { return 0; }
}

(async () => {
  console.log('WebDAV resilience tests\n');
  await cleanupNotes();

  // 1. Авторизация
  {
    const noAuth = await new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, path: '/dav/', method: 'OPTIONS' }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      r.on('error', reject);
      r.end();
    });
    check('запрос без пароля отклоняется', noAuth === 401, `status ${noAuth}`);
    const withAuth = await request('OPTIONS', '/dav/');
    check('OPTIONS с паролем', withAuth.status === 200 && /1,2/.test(withAuth.headers.dav || ''), `status ${withAuth.status}`);
  }

  // 2. Загрузка -> чтение -> сверка хеша -> удаление
  {
    const name = `test-roundtrip-${Date.now()}.bin`;
    const data = crypto.randomBytes(256 * 1024);
    const hash = crypto.createHash('md5').update(data).digest('hex');
    const up = await request('PUT', `/dav/${name}`, { body: data, headers: { 'content-length': String(data.length) } });
    check('PUT 256 КБ принят', up.status === 201, `status ${up.status}, ${up.ms} ms`);
    check('ответ на PUT быстрый (< 5 с)', up.ms < 5000, `${up.ms} ms`);

    const down = await waitForFile(name);
    const downHash = crypto.createHash('md5').update(down.body).digest('hex');
    check('файл читается и совпадает по MD5', downHash === hash, `${down.body.length} байт`);
    check('Content-Length совпадает', Number(down.headers['content-length']) === data.length, down.headers['content-length']);

    const del = await request('DELETE', `/dav/${name}`);
    check('DELETE удаляет файл', del.status === 204, `status ${del.status}`);
    const after = await request('PROPFIND', `/dav/${name}`, { headers: { depth: '0' } });
    check('после удаления файла нет', after.status === 404, `status ${after.status}`);
  }

  // 3. Файл больше лимита — отказ до передачи тела
  {
    const name = `test-toolarge-${Date.now()}.bin`;
    const res = await request('PUT', `/dav/${name}`, {
      headers: { 'content-length': String(5 * 1024 * 1024 * 1024) },
      timeout: 10000,
    });
    check('файл 5 ГБ отклонён с 413', res.status === 413, `status ${res.status}, ${res.ms} ms`);
    check('отказ быстрый (< 3 с, тело не передавалось)', res.ms < 3000, `${res.ms} ms`);
    const prop = await request('PROPFIND', `/dav/${name}`, { headers: { depth: '0' } });
    check('отклонённый файл не появился в списке', prop.status === 404, `status ${prop.status}`);
  }

  // 4. Обрыв соединения посреди передачи
  {
    const name = `test-abort-${Date.now()}.bin`;
    const before = tmpCount();
    await new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1',
        port: PORT,
        path: `/dav/${name}`,
        method: 'PUT',
        headers: { authorization: AUTH, 'content-length': String(8 * 1024 * 1024) },
      }, (res) => { res.resume(); });
      req.on('error', () => resolve());
      req.write(crypto.randomBytes(512 * 1024));
      setTimeout(() => { req.destroy(); resolve(); }, 400);
    });
    await sleep(3000);
    const health = await request('OPTIONS', '/dav/');
    check('сервер жив после обрыва', health.status === 200, `status ${health.status}`);
    check('временные файлы не накапливаются', tmpCount() <= before + 1, `было ${before}, стало ${tmpCount()}`);
    const prop = await request('PROPFIND', `/dav/${name}`, { headers: { depth: '0' } });
    check('оборванный файл не попал в список', prop.status === 404, `status ${prop.status}`);
    await deleteIfExists(name);
  }

  // 5. Параллельные загрузки
  {
    const stamp = Date.now();
    const files = [0, 1, 2].map((i) => ({
      name: `test-parallel-${stamp}-${i}.bin`,
      data: crypto.randomBytes(1024 * 1024),
    }));
    const results = await Promise.all(files.map((f) => request('PUT', `/dav/${f.name}`, {
      body: f.data,
      headers: { 'content-length': String(f.data.length) },
    })));
    check('три параллельных PUT приняты', results.every((r) => r.status === 201), results.map((r) => r.status).join(','));
    for (const f of files) {
      const down = await waitForFile(f.name);
      const same = crypto.createHash('md5').update(down.body).digest('hex') ===
        crypto.createHash('md5').update(f.data).digest('hex');
      check(`содержимое ${f.name} цело`, same, `${down.body.length} байт`);
      await request('DELETE', `/dav/${f.name}`);
    }
  }

  // 6. Обрыв скачивания: сервер не должен падать и «залипать»
  {
    const listing = await request('PROPFIND', '/dav/', { headers: { depth: '1' } });
    const xml = listing.body.toString('utf8');
    const entries = [...xml.matchAll(/<D:href>([^<]+)<\/D:href>[\s\S]*?<D:getcontentlength>(\d+)<\/D:getcontentlength>/g)]
      .map((m) => ({ href: m[1], size: Number(m[2]) }))
      .filter((e) => e.size > 5 * 1024 * 1024);
    if (!entries.length) {
      check('обрыв скачивания (нет большого файла для теста)', true, 'пропущено');
    } else {
      const victim = entries[0];
      await new Promise((resolve) => {
        const req = http.request({
          host: '127.0.0.1',
          port: PORT,
          path: victim.href,
          method: 'GET',
          headers: { authorization: AUTH },
        }, (res) => {
          res.once('data', () => {
            res.destroy();
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => resolve());
        req.end();
      });
      await sleep(1500);
      const health = await request('OPTIONS', '/dav/');
      check('сервер жив после обрыва скачивания', health.status === 200, `status ${health.status}, файл ${Math.round(victim.size / 1048576)} МБ`);
    }
  }

  await cleanupNotes();
  console.log(`\nИтого: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Тестовый прогон упал:', e);
  process.exit(2);
});
