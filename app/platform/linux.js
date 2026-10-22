'use strict';

// Linux: пользовательское монтирование WebDAV через GVFS (без root),
// автозапуск — файл в ~/.config/autostart.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, runSync } = require('./common');

const DESKTOP_FILE = path.join(os.homedir(), '.config', 'autostart', 'tgdrive-easy.desktop');

function davUrl({ port, user, pass }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
  return `dav://${auth}localhost:${port}/dav`;
}

module.exports = {
  name: 'linux',
  mountAvailable: true,

  mountLabel() {
    return 'GVFS (dav://)';
  },

  async mount({ port, user, pass }) {
    if (!runSync('gio', ['version'])) {
      return { ok: false, error: 'gio not found (install gvfs-daemons)' };
    }
    const url = davUrl({ port, user, pass });
    const res = await run('gio', ['mount', url], 45000);
    if (res.ok) return { ok: true };
    const detail = (res.stderr || '').trim().split('\n').pop() || 'gio mount failed';
    return { ok: false, error: detail };
  },

  async unmount({ port }) {
    const res = await run('gio', ['mount', '-u', `dav://localhost:${port}/dav`], 20000);
    return { ok: res.ok };
  },

  async setAutostart(enabled, { exePath }) {
    try {
      if (!enabled) {
        fs.rmSync(DESKTOP_FILE, { force: true });
        return { ok: true };
      }
      if (!exePath) return { ok: false, error: 'executable path is unknown' };
      fs.mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
      const entry = [
        '[Desktop Entry]',
        'Type=Application',
        'Name=TGDrive-Easy',
        'Comment=Telegram Saved Messages as a drive',
        `Exec="${exePath}"`,
        'Terminal=false',
        'X-GNOME-Autostart-enabled=true',
        '',
      ].join('\n');
      fs.writeFileSync(DESKTOP_FILE, entry, 'utf8');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
