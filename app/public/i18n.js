'use strict';

// IIFE: глобальная функция t конфликтовала бы с `const { t }` в app.js.
(function () {

// Словари интерфейса. Ключи общие для веб-консоли и лаунчера.
const DICT = {
  en: {
    'app.title': 'TGDrive-Easy — Saved Messages',
    'brand': 'TGDrive-Easy',
    'settings.open': '⚙ Settings',
    'settings.close': '✕ Close',
    'logout': 'Sign out',
    'settings.title': 'Settings',
    'settings.updates': 'Updates',
    'settings.currentVersion': 'Current version:',
    'settings.checkUpdates': 'Check for updates',
    'status.checkingUpdates': 'Checking…',
    'status.upToDate': 'You have the latest version.',
    'status.updateAvailable': 'Version {version} is available.',
    'status.updateError': 'Could not check for updates: {error}',
    'banner.updateAvailable': 'New version available:',
    'banner.upToDate': 'You have the latest version ({version}).',
    'banner.updateError': 'Could not check for updates.',
    'banner.download': 'Download',
    'settings.language': 'Language',
    'settings.languageAuto': 'System',
    'settings.languageHint': 'System uses the browser or OS locale.',
    'settings.drive': 'Drive',
    'settings.driveMounted': 'Drive {drive} is mounted ({mode}).',
    'settings.driveNotMounted': 'Drive {drive} is not mounted ({mode}).',
    'settings.autoMount': 'Mount the drive at startup',
    'settings.mount': 'Mount',
    'settings.unmount': 'Unmount',
    'settings.autoStart': 'Start with the system (autostart)',
    'settings.proxyTitle': 'Telegram proxy',
    'settings.proxyType': 'Type',
    'settings.proxySocks5': 'SOCKS5',
    'settings.proxyMtproto': 'MTProto (tg://proxy)',
    'settings.proxyNone': 'No proxy (direct)',
    'settings.server': 'Server',
    'settings.port': 'Port',
    'settings.user': 'Username (optional)',
    'settings.pass': 'Password (optional)',
    'settings.secret': 'Secret',
    'settings.proxyHint': 'You can paste a whole tg://proxy?server=…&port=…&secret=… link — the fields will be filled in.',
    'settings.saveApply': 'Save and apply',
    'settings.pasteLink': 'Paste tg:// link',
    'settings.closeBtn': 'Close',
    'login.title': 'Sign in to Telegram',
    'login.subtitle': 'Enter your phone number, then the code from Telegram. No API keys required.',
    'login.phone': 'Phone number',
    'login.phonePlaceholder': '+7 999 123-45-67',
    'login.sendCode': 'Send code',
    'login.code': 'Code from Telegram',
    'login.codePlaceholder': '12345',
    'login.signIn': 'Sign in',
    'login.changeNumber': 'Change number',
    'login.password': 'Two-step verification password',
    'login.passwordHint': 'Hint: {hint}',
    'login.codeViaApp': 'The code was sent to your Telegram app (chat "Telegram").',
    'login.codeViaSms': 'The code was sent by SMS.',
    'files.search': 'Filter by name…',
    'files.refresh': 'Refresh',
    'files.upload': 'Upload to Saved Messages',
    'files.downloadSelected': 'Download selected',
    'files.downloadSelectedN': 'Download selected ({n})',
    'files.name': 'Name',
    'files.size': 'Size',
    'files.date': 'Date',
    'files.loadMore': 'Load more',
    'files.noFiles': 'No files found',
    'files.showing': 'Showing {n} of {total}',
    'files.loadingList': 'Loading list…',
    'files.loadingMore': 'Loading more…',
    'files.downloading': 'Downloading {n} file(s)… the browser will ask where to save.',
    'files.downloadSent': 'Download requests sent.',
    'files.uploading': 'Uploading {n} file(s) to Saved Messages… this may take a while.',
    'files.uploaded': 'Uploaded {done} of {total}.',
    'files.download': 'Download',
    'footer': 'Local client • data stays on this computer • files are stored in Telegram',
    'status.mounting': 'Mounting…',
    'status.mountOk': 'Drive mounted.',
    'status.mountFailed': 'Mount failed.',
    'status.unmounting': 'Unmounting…',
    'status.unmountOk': 'Drive unmounted.',
    'status.autoMountOn': 'The drive will be mounted at every start.',
    'status.autoMountOff': 'The drive will not be mounted automatically.',
    'status.autoStartOn': 'TGDrive-Easy will start with the system.',
    'status.autoStartOff': 'Autostart is off.',
    'status.proxySaved': 'Proxy saved.',
    'status.proxyRestored': ' Telegram connection restored.',
    'status.proxyNoConn': ' Connection: {error}',
    'status.proxySignIn': ' Sign in to check the connection.',
    'status.portRequired': 'Server and port are required.',
    'status.secretRequired': 'MTProto secret is required.',
    'status.applying': 'Applying…',
    'status.noLink': 'No tg://proxy link found in the clipboard.',
    'status.linkParsed': 'Link parsed — press "Save and apply".',
    'status.enterPhone': 'Enter your phone number',
    'status.sending': 'Sending code…',
    'status.enterCode': 'Enter the code',
    'status.checkingCode': 'Checking code…',
    'status.enterPassword': 'Enter the password',
    'status.checkingPassword': 'Checking password…',
    'status.serverUnavailable': 'Server unavailable: {error}',
    'status.languageSaved': 'Language updated.',
    'signout.confirm': 'Sign out of this account on this computer?',
  },
  ru: {
    'app.title': 'TGDrive-Easy — Избранное',
    'brand': 'TGDrive-Easy',
    'settings.open': '⚙ Настройки',
    'settings.close': '✕ Закрыть',
    'logout': 'Выйти',
    'settings.title': 'Настройки',
    'settings.updates': 'Обновления',
    'settings.currentVersion': 'Установленная версия:',
    'settings.checkUpdates': 'Проверить обновления',
    'status.checkingUpdates': 'Проверяю…',
    'status.upToDate': 'У вас последняя версия.',
    'status.updateAvailable': 'Доступна версия {version}.',
    'status.updateError': 'Не удалось проверить обновления: {error}',
    'banner.updateAvailable': 'Доступна новая версия:',
    'banner.upToDate': 'Установлена последняя версия ({version}).',
    'banner.updateError': 'Не удалось проверить обновления.',
    'banner.download': 'Скачать',
    'settings.language': 'Язык',
    'settings.languageAuto': 'Системный',
    'settings.languageHint': 'Системный — по локали браузера или ОС.',
    'settings.drive': 'Диск',
    'settings.driveMounted': 'Диск {drive} смонтирован ({mode}).',
    'settings.driveNotMounted': 'Диск {drive} не смонтирован ({mode}).',
    'settings.autoMount': 'Монтировать диск при запуске',
    'settings.mount': 'Смонтировать',
    'settings.unmount': 'Снять',
    'settings.autoStart': 'Запускать вместе с системой (автозапуск)',
    'settings.proxyTitle': 'Прокси Telegram',
    'settings.proxyType': 'Тип',
    'settings.proxySocks5': 'SOCKS5',
    'settings.proxyMtproto': 'MTProto (tg://proxy)',
    'settings.proxyNone': 'Без прокси (напрямую)',
    'settings.server': 'Сервер',
    'settings.port': 'Порт',
    'settings.user': 'Логин (необязательно)',
    'settings.pass': 'Пароль (необязательно)',
    'settings.secret': 'Секрет',
    'settings.proxyHint': 'Можно вставить ссылку tg://proxy?server=…&port=…&secret=… целиком — поля заполнятся сами.',
    'settings.saveApply': 'Сохранить и применить',
    'settings.pasteLink': 'Вставить ссылку tg://',
    'settings.closeBtn': 'Закрыть',
    'login.title': 'Вход в Telegram',
    'login.subtitle': 'Введите номер телефона, затем код из Telegram. Ключи API не нужны.',
    'login.phone': 'Номер телефона',
    'login.phonePlaceholder': '+7 999 123-45-67',
    'login.sendCode': 'Отправить код',
    'login.code': 'Код из Telegram',
    'login.codePlaceholder': '12345',
    'login.signIn': 'Войти',
    'login.changeNumber': 'Изменить номер',
    'login.password': 'Пароль двухэтапной проверки',
    'login.passwordHint': 'Подсказка: {hint}',
    'login.codeViaApp': 'Код отправлен в приложение Telegram (чат «Telegram»).',
    'login.codeViaSms': 'Код отправлен по SMS.',
    'files.search': 'Фильтр по имени…',
    'files.refresh': 'Обновить',
    'files.upload': 'Загрузить в «Избранное»',
    'files.downloadSelected': 'Скачать выбранное',
    'files.downloadSelectedN': 'Скачать выбранное ({n})',
    'files.name': 'Имя',
    'files.size': 'Размер',
    'files.date': 'Дата',
    'files.loadMore': 'Загрузить ещё',
    'files.noFiles': 'Файлы не найдены',
    'files.showing': 'Показано {n} из {total}',
    'files.loadingList': 'Загружаю список…',
    'files.loadingMore': 'Загружаю ещё…',
    'files.downloading': 'Скачиваю {n} файл(ов)… браузер спросит, куда сохранить.',
    'files.downloadSent': 'Запросы на скачивание отправлены.',
    'files.uploading': 'Загружаю {n} файл(ов) в «Избранное»… это может занять время.',
    'files.uploaded': 'Загружено {done} из {total}.',
    'files.download': 'Скачать',
    'footer': 'Локальный клиент • данные остаются на этом компьютере • файлы хранятся в Telegram',
    'status.mounting': 'Монтирую…',
    'status.mountOk': 'Диск смонтирован.',
    'status.mountFailed': 'Не удалось смонтировать.',
    'status.unmounting': 'Снимаю…',
    'status.unmountOk': 'Диск снят.',
    'status.autoMountOn': 'Диск будет монтироваться при каждом запуске.',
    'status.autoMountOff': 'Диск не будет монтироваться автоматически.',
    'status.autoStartOn': 'TGDrive-Easy будет запускаться вместе с системой.',
    'status.autoStartOff': 'Автозапуск выключен.',
    'status.proxySaved': 'Прокси сохранён.',
    'status.proxyRestored': ' Соединение с Telegram восстановлено.',
    'status.proxyNoConn': ' Соединение: {error}',
    'status.proxySignIn': ' Войдите, чтобы проверить соединение.',
    'status.portRequired': 'Нужны сервер и порт.',
    'status.secretRequired': 'Нужен секрет MTProto.',
    'status.applying': 'Применяю…',
    'status.noLink': 'В буфере обмена нет ссылки tg://proxy.',
    'status.linkParsed': 'Ссылка разобрана — нажмите «Сохранить и применить».',
    'status.enterPhone': 'Введите номер телефона',
    'status.sending': 'Отправляю код…',
    'status.enterCode': 'Введите код',
    'status.checkingCode': 'Проверяю код…',
    'status.enterPassword': 'Введите пароль',
    'status.checkingPassword': 'Проверяю пароль…',
    'status.serverUnavailable': 'Сервер недоступен: {error}',
    'status.languageSaved': 'Язык обновлён.',
    'signout.confirm': 'Выйти из этого аккаунта на этом компьютере?',
  },
};

let lang = 'en';

function detect() {
  const list = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || 'en'];
  for (const l of list) {
    if (String(l).toLowerCase().startsWith('ru')) return 'ru';
    if (String(l).toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

function t(key, params) {
  const table = DICT[lang] || DICT.en;
  let text = table[key];
  if (text === undefined) text = DICT.en[key] !== undefined ? DICT.en[key] : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split('{' + k + '}').join(String(v));
    }
  }
  return text;
}

function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
  });
  document.title = t('app.title');
  document.documentElement.lang = lang;
}

function setLang(next) {
  lang = next === 'ru' ? 'ru' : 'en';
  applyI18n();
}

window.TD_I18N = {
  t,
  setLang,
  applyI18n,
  detect,
  get lang() { return lang; },
};
})();
