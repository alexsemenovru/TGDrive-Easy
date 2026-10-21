const base = 'http://127.0.0.1:4100';

(async () => {
  const html = await (await fetch(base + '/')).text();
  const token = (html.match(/TD_TOKEN = '([a-f0-9]+)'/) || [])[1];
  const h = { 'x-td-token': token, 'content-type': 'application/json' };

  const s0 = await (await fetch(base + '/api/settings', { headers: h })).json();
  console.log('initial: autoStart =', s0.autoStart, '| canAutoStart =', s0.canAutoStart);

  const on = await (await fetch(base + '/api/settings/autostart', { method: 'POST', headers: h, body: JSON.stringify({ enabled: true }) })).json();
  console.log('enable ->', JSON.stringify(on));

  const off = await (await fetch(base + '/api/settings/autostart', { method: 'POST', headers: h, body: JSON.stringify({ enabled: false }) })).json();
  console.log('disable ->', JSON.stringify(off));

  const s1 = await (await fetch(base + '/api/settings', { headers: h })).json();
  console.log('final: autoStart =', s1.autoStart);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
