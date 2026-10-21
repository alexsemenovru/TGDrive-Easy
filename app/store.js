'use strict';

// Индекс файлов «Избранного»: один раз читает всю историю, хранит на диске,
// дальше отдаёт список мгновенно и обновляет его в фоне.

const fs = require('fs');
const path = require('path');

module.exports = function createStore({ getClient, describe, dataDir, log }) {
  const INDEX_FILE = path.join(dataDir, 'index.json');
  const TTL = 15 * 60 * 1000;
  let items = [];
  let updatedAt = 0;
  let syncing = null;
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      items = Array.isArray(raw.items) ? raw.items : [];
      updatedAt = raw.updatedAt || 0;
    } catch (_) {
      items = [];
      updatedAt = 0;
    }
  }

  function save() {
    try {
      fs.writeFileSync(INDEX_FILE, JSON.stringify({ updatedAt, items }));
    } catch (e) {
      log && log('index: save failed: ' + (e.message || e));
    }
  }

  async function fullSync() {
    const client = await getClient();
    const fresh = [];
    let offsetId = 0;
    for (let page = 0; page < 500; page++) {
      const msgs = await client.getMessages('me', { limit: 100, offsetId });
      if (!msgs.length) break;
      for (const m of msgs) {
        const d = describe(m);
        if (d && d.size > 0) fresh.push(d);
      }
      offsetId = msgs[msgs.length - 1].id;
      if (msgs.length < 100) break;
    }
    items = fresh;
    updatedAt = Date.now();
    save();
    log && log(`index: synced ${items.length} files from ${items.length ? 'history' : 'empty'}`);
  }

  function refresh(force) {
    load();
    if (syncing) return syncing;
    if (!force && items.length && Date.now() - updatedAt < TTL) return Promise.resolve(items);
    syncing = (async () => {
      try {
        await fullSync();
      } catch (e) {
        log && log('index: sync failed: ' + (e.message || e));
      } finally {
        syncing = null;
      }
    })();
    return syncing.then(() => items);
  }

  async function list() {
    load();
    if (!items.length) await refresh(true);
    else if (Date.now() - updatedAt > TTL) refresh(false).catch(() => {});
    return items;
  }

  function add(item) {
    load();
    if (!item || !item.id || items.some((i) => i.id === item.id)) return;
    items.unshift(item);
    updatedAt = Date.now();
    save();
  }

  function remove(id) {
    load();
    const next = items.filter((i) => i.id !== id);
    if (next.length !== items.length) {
      items = next;
      updatedAt = Date.now();
      save();
    }
  }

  load();
  if (!items.length || Date.now() - updatedAt > TTL) refresh(false).catch(() => {});

  return { list, refresh, add, remove };
};
