'use strict';

// Выбор платформенной реализации по process.platform.
module.exports = process.platform === 'win32'
  ? require('./win')
  : process.platform === 'darwin'
    ? require('./darwin')
    : require('./linux');
