const fs = require('fs');
const base = 'http://127.0.0.1:4100';

(async () => {
  const html = await (await fetch(base + '/')).text();
  const token = (html.match(/TD_TOKEN = '([a-f0-9]+)'/) || [])[1];
  const h = { 'x-td-token': token, 'content-type': 'application/json' };

  console.log('settings page has Settings panel:', /id="settingsView"/.test(html));
  console.log('GET /api/settings:', await (await fetch(base + '/api/settings', { headers: h })).text());

  console.log('auto-mount off:', await (await fetch(base + '/api/settings/auto-mount', { method: 'POST', headers: h, body: JSON.stringify({ enabled: false }) })).text());
  const file = process.env.APPDATA + '\\TeleDriveLocal\\data\\settings.json';
  console.log('persisted:', fs.readFileSync(file, 'utf8').replace(/\s+/g, ' '));
  console.log('auto-mount on:', await (await fetch(base + '/api/settings/auto-mount', { method: 'POST', headers: h, body: JSON.stringify({ enabled: true }) })).text());

  const proxy = { type: 'socks5', host: '127.0.0.1', port: 10808, user: '', pass: '', secret: '' };
  console.log('proxy apply:', await (await fetch(base + '/api/settings/proxy', { method: 'POST', headers: h, body: JSON.stringify(proxy) })).text());

  console.log('unmount via web:', await (await fetch(base + '/api/unmount', { method: 'POST', headers: h })).text());
  console.log('mount via web:', await (await fetch(base + '/api/mount', { method: 'POST', headers: h })).text());
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
