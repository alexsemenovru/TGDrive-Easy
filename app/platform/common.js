'use strict';

// Платформенный слой: монтирование диска и автозапуск.
// Сервер общается только с этим интерфейсом, поэтому Windows/Linux/macOS
// не тянут чужой код.

const { execFile, execFileSync } = require('child_process');

function run(file, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
    });
  });
}

function runSync(file, args, timeout = 20000) {
  try {
    execFileSync(file, args, { stdio: 'ignore', timeout });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { run, runSync };
