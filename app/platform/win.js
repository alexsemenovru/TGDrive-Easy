'use strict';

// Windows: WebDAV через штатный клиент, автозапуск через ключ Run.

const { run, runSync } = require('./common');
const { spawn } = require('child_process');

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const AUTOSTART_NAME = 'TGDrive-Easy';

module.exports = {
  name: 'windows',
  mountAvailable: true,

  async mount({ drive, port, user, pass }) {
    const args = [
      'use', drive, `http://localhost:${port}/dav`,
      `/user:${user}`, pass, '/persistent:no',
    ];
    for (let attempt = 1; attempt <= 8; attempt++) {
      if (await run('net.exe', args)) return { ok: true };
      await run('net.exe', ['use', drive, '/delete', '/y'], 15000);
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { ok: false, error: 'net use failed (busy or webdav unavailable)' };
  },

  async unmount({ drive }) {
    const ok = await run('net.exe', ['use', drive, '/delete', '/y'], 20000);
    return { ok: ok.ok };
  },

  async setAutostart(enabled, { exePath }) {
    if (!exePath) return { ok: false, error: 'executable path is unknown (running from source)' };
    const args = enabled
      ? ['add', RUN_KEY, '/v', AUTOSTART_NAME, '/t', 'REG_SZ', '/d', `"${exePath}"`, '/f']
      : ['delete', RUN_KEY, '/v', AUTOSTART_NAME, '/f'];
    const res = await run('reg.exe', args);
    return res.ok ? { ok: true } : { ok: false, error: 'could not update the registry' };
  },

  async cleanupLegacy({ port }) {
    const res = await run('net.exe', ['use'], 15000);
    const marks = [];
    for (const line of String(res.stdout || '').split(/\r?\n/)) {
      const m = line.match(/^([A-Z]):\s+.*localhost:\d+\/dav/i);
      if (m) marks.push(m[1] + ':');
    }
    for (const drive of marks) {
      await run('net.exe', ['use', drive, '/delete', '/y'], 15000);
      console.log('removed legacy mapping', drive);
    }
    return marks.length;
  },

  revealDrive({ drive }) {
    try {
      const child = spawn('explorer.exe', [drive + '\\'], { detached: true, stdio: 'ignore' });
      child.unref();
      return true;
    } catch (_) {
      return false;
    }
  },

  defaultMountPoint() {
    return null;
  },
};
