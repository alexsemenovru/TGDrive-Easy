'use strict';

// Хранение сессии Telegram.
// Windows: DPAPI (CryptProtectData через .NET) — ключ привязан к учётной записи.
// macOS: Keychain (security).
// Linux: secret-tool (libsecret), иначе файл с правами 0600 и предупреждением.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DATA_DIR = process.env.TD_DATA_DIR
  ? path.resolve(process.env.TD_DATA_DIR)
  : path.join(__dirname, 'data');

const BIN_FILE = path.join(DATA_DIR, 'session.bin');
const LEGACY_FILE = path.join(DATA_DIR, 'session.txt');

const name = 'TGDrive-Easy';
const account = 'session';

function log(message) {
  try { console.log(`[session] ${message}`); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Windows DPAPI
// ---------------------------------------------------------------------------
function powershell(script, payload) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    input: '',
    env: Object.assign({}, process.env, { TD_SESSION_B64: payload }),
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  });
  if (res.status !== 0) {
    throw new Error((res.stderr || '').trim() || 'powershell failed');
  }
  return res.stdout.trim();
}

const PROTECT_PS = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$bytes=[Convert]::FromBase64String($env:TD_SESSION_B64)',
  '$out=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Convert]::ToBase64String($out)',
].join('; ');

const UNPROTECT_PS = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$bytes=[Convert]::FromBase64String($env:TD_SESSION_B64)',
  '$out=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Convert]::ToBase64String($out)',
].join('; ');

function dpapiProtect(plain) {
  const b64 = Buffer.from(plain, 'utf8').toString('base64');
  return powershell(PROTECT_PS, b64);
}

function dpapiUnprotect(cipherB64) {
  const b64 = powershell(UNPROTECT_PS, cipherB64);
  return Buffer.from(b64, 'base64').toString('utf8');
}

// ---------------------------------------------------------------------------
// macOS Keychain / Linux secret-tool
// ---------------------------------------------------------------------------
function keychainSave(secret) {
  if (process.platform === 'darwin') {
    const res = spawnSync('security', [
      'add-generic-password', '-U', '-a', account, '-s', name, '-w', secret,
    ], { encoding: 'utf8', timeout: 15000 });
    return res.status === 0;
  }
  const res = spawnSync('secret-tool', [
    'store', '--label', name, 'service', name, 'account', account,
  ], { input: secret, encoding: 'utf8', timeout: 15000 });
  return res.status === 0;
}

function keychainLoad() {
  if (process.platform === 'darwin') {
    const res = spawnSync('security', ['find-generic-password', '-a', account, '-s', name, '-w'], {
      encoding: 'utf8', timeout: 15000,
    });
    return res.status === 0 ? res.stdout.replace(/\n$/, '') : '';
  }
  const res = spawnSync('secret-tool', ['lookup', 'service', name, 'account', account], {
    encoding: 'utf8', timeout: 15000,
  });
  return res.status === 0 ? res.stdout.replace(/\n$/, '') : '';
}

function keychainClear() {
  if (process.platform === 'darwin') {
    spawnSync('security', ['delete-generic-password', '-a', account, '-s', name], { timeout: 15000 });
  } else {
    spawnSync('secret-tool', ['clear', 'service', name, 'account', account], { timeout: 15000 });
  }
}

// ---------------------------------------------------------------------------
// Публичный интерфейс
// ---------------------------------------------------------------------------
function readFileSafe(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
}

function legacySession() {
  return readFileSafe(LEGACY_FILE);
}

function removeLegacy() {
  const plain = legacySession();
  if (!plain) return;
  try {
    // затираем содержимое перед удалением
    fs.writeFileSync(LEGACY_FILE, '0'.repeat(plain.length), 'utf8');
  } catch (_) {}
  try { fs.unlinkSync(LEGACY_FILE); } catch (_) {}
}

function save(session) {
  if (!session) return false;
  try {
    if (process.platform === 'win32') {
      const cipher = dpapiProtect(session);
      fs.writeFileSync(BIN_FILE, 'dpapi1:' + cipher, 'utf8');
      removeLegacy();
      return true;
    }
    if (keychainSave(session)) {
      try { fs.rmSync(BIN_FILE, { force: true }); } catch (_) {}
      removeLegacy();
      return true;
    }
    fs.writeFileSync(BIN_FILE, session, { encoding: 'utf8', mode: 0o600 });
    removeLegacy();
    log('keychain unavailable: session stored in a 0600 file');
    return true;
  } catch (e) {
    log('save failed: ' + e.message);
    return false;
  }
}

function load() {
  if (process.platform === 'win32') {
    const raw = readFileSafe(BIN_FILE);
    if (raw.startsWith('dpapi1:')) {
      try {
        const plain = dpapiUnprotect(raw.slice('dpapi1:'.length));
        removeLegacy();
        return plain;
      } catch (e) {
        log('unprotect failed: ' + e.message);
        return '';
      }
    }
    const legacy = legacySession();
    if (legacy) {
      save(legacy);
      return legacy;
    }
    return '';
  }

  const fromChain = keychainLoad();
  if (fromChain) {
    removeLegacy();
    return fromChain;
  }
  const legacy = legacySession();
  if (legacy) {
    save(legacy);
    return legacy;
  }
  return readFileSafe(BIN_FILE);
}

function exists() {
  if (fs.existsSync(BIN_FILE)) return true;
  if (fs.existsSync(LEGACY_FILE)) return true;
  return !!keychainLoad();
}

function clear() {
  try { fs.rmSync(BIN_FILE, { force: true }); } catch (_) {}
  removeLegacy();
  keychainClear();
}

module.exports = { load, save, exists, clear, storage: process.platform === 'win32' ? 'dpapi' : 'keychain' };

// Страховка: если старая версия приложения или сторонний процесс
// восстановит plaintext-файл, он не задержится дольше минуты.
setInterval(() => {
  try {
    if (fs.existsSync(LEGACY_FILE)) removeLegacy();
  } catch (_) {}
}, 60 * 1000).unref();
