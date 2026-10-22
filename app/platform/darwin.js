'use strict';

// macOS: монтирование через Finder (osascript, без root),
// автозапуск — LaunchAgent.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./common');

const AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.tgdrive.easy.plist');
const LABEL = 'com.tgdrive.easy';
const VOLUME = '/Volumes/dav';

function osa(script) {
  return run('osascript', ['-e', script], 45000);
}

module.exports = {
  name: 'darwin',
  mountAvailable: true,

  mountLabel() {
    return VOLUME;
  },

  async mount({ port, user, pass }) {
    const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
    const url = `http://${auth}localhost:${port}/dav`;
    const res = await osa(`mount volume "${url}"`);
    if (res.ok) return { ok: true };
    return { ok: false, error: (res.stderr || '').trim().split('\n').pop() || 'mount volume failed' };
  },

  async unmount() {
    let res = await osa(`tell application "Finder" to eject disk "dav"`);
    if (res.ok) return { ok: true };
    res = await run('diskutil', ['unmount', VOLUME], 20000);
    return { ok: res.ok };
  },

  async setAutostart(enabled, { exePath }) {
    try {
      if (!enabled) {
        await run('launchctl', ['unload', AGENT], 15000);
        fs.rmSync(AGENT, { force: true });
        return { ok: true };
      }
      if (!exePath) return { ok: false, error: 'executable path is unknown' };
      fs.mkdirSync(path.dirname(AGENT), { recursive: true });
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${exePath}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
      fs.writeFileSync(AGENT, plist, 'utf8');
      await run('launchctl', ['unload', AGENT], 10000);
      const res = await run('launchctl', ['load', AGENT], 15000);
      return res.ok ? { ok: true } : { ok: false, error: (res.stderr || '').trim() || 'launchctl load failed' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
