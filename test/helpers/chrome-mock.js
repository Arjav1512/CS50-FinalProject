// Minimal hand-written mock of the chrome.* APIs used by Digital Diary.
// Storage reads/writes are asynchronous and yield to the event loop, so
// unsynchronised read-modify-write code really does lose updates here.

const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = v => (v === undefined ? undefined : structuredClone(v));

export class MockEvent {
  constructor() { this.listeners = []; }
  addListener(fn) { this.listeners.push(fn); }
  removeListener(fn) { this.listeners = this.listeners.filter(l => l !== fn); }
  hasListener(fn) { return this.listeners.includes(fn); }
  hasListeners() { return this.listeners.length > 0; }
  // Calls every listener and waits for any promises they return.
  async dispatch(...args) {
    const results = this.listeners.map(fn => fn(...args));
    return Promise.all(results);
  }
}

function withCallback(promise, cb) {
  if (typeof cb === 'function') promise.then(v => cb(v));
  return promise;
}

function createStorageArea(name, onChanged) {
  let data = {};
  const area = {
    _name: name,
    _dump: () => clone(data),
    _load: obj => { data = clone(obj); },
    get(keys, cb) {
      const p = (async () => {
        await tick();
        if (keys === null || keys === undefined) return clone(data);
        if (typeof keys === 'string') keys = [keys];
        const out = {};
        if (Array.isArray(keys)) {
          for (const k of keys) if (k in data) out[k] = clone(data[k]);
        } else {
          for (const [k, def] of Object.entries(keys)) out[k] = k in data ? clone(data[k]) : clone(def);
        }
        return out;
      })();
      return withCallback(p, cb);
    },
    set(items, cb) {
      const p = (async () => {
        await tick();
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
          data[k] = clone(v);
        }
        onChanged.dispatch(changes, name);
      })();
      return withCallback(p, cb);
    },
    remove(keys, cb) {
      const p = (async () => {
        await tick();
        if (typeof keys === 'string') keys = [keys];
        for (const k of keys) delete data[k];
      })();
      return withCallback(p, cb);
    },
    clear(cb) {
      const p = (async () => { await tick(); data = {}; })();
      return withCallback(p, cb);
    }
  };
  return area;
}

export function createChromeMock({ now = () => Date.now() } = {}) {
  const allEvents = [];
  const ev = () => { const e = new MockEvent(); allEvents.push(e); return e; };

  const storageOnChanged = ev();
  const tabsById = new Map();
  let focusedWindowId = 1;
  let idleState = 'active';
  const alarms = new Map();

  const chrome = {
    storage: {
      onChanged: storageOnChanged,
      local: createStorageArea('local', storageOnChanged),
      session: createStorageArea('session', storageOnChanged)
    },

    alarms: {
      onAlarm: ev(),
      async create(name, info = {}) {
        const scheduledTime = info.when ?? now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60000;
        alarms.set(name, { name, scheduledTime, periodInMinutes: info.periodInMinutes });
      },
      async get(name) { return clone(alarms.get(name)); },
      async getAll() { return [...alarms.values()].map(clone); },
      async clear(name) { return alarms.delete(name); },
      async clearAll() { alarms.clear(); return true; }
    },

    idle: {
      onStateChanged: ev(),
      _detectionInterval: null,
      setDetectionInterval(seconds) { chrome.idle._detectionInterval = seconds; },
      async queryState() { return idleState; }
    },

    tabs: {
      onActivated: ev(),
      onUpdated: ev(),
      onRemoved: ev(),
      async get(tabId) {
        await tick();
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}.`);
        return clone(tab);
      },
      async query(q = {}) {
        await tick();
        return [...tabsById.values()].filter(t =>
          (q.active === undefined || t.active === q.active) &&
          (q.windowId === undefined || t.windowId === q.windowId) &&
          (!q.lastFocusedWindow && !q.currentWindow || t.windowId === focusedWindowId)
        ).map(clone);
      }
    },

    windows: {
      WINDOW_ID_NONE: -1,
      onFocusChanged: ev(),
      async getLastFocused() {
        await tick();
        const id = focusedWindowId === -1 ? 1 : focusedWindowId;
        return { id, focused: focusedWindowId !== -1 };
      }
    },

    runtime: {
      id: 'mock-extension-id',
      onMessage: ev(),
      onInstalled: ev(),
      onStartup: ev(),
      lastError: undefined,
      getURL: p => `chrome-extension://mock-extension-id/${p}`,
      // Delivers a message to onMessage listeners like Chrome does.
      sendMessage(msg, sender = { id: chrome.runtime.id, url: chrome.runtime.getURL('ui.html') }) {
        return new Promise(resolve => {
          let responded = false;
          const sendResponse = v => { if (!responded) { responded = true; resolve(v); } };
          let keepOpen = false;
          for (const fn of chrome.runtime.onMessage.listeners) {
            if (fn(msg, sender, sendResponse) === true) keepOpen = true;
          }
          if (!keepOpen) sendResponse(undefined);
        });
      }
    },

    notifications: {
      _created: [],
      async create(id, options) {
        if (typeof id === 'object') { options = id; id = `n${chrome.notifications._created.length}`; }
        chrome.notifications._created.push({ id, ...clone(options) });
        return id;
      }
    },

    scripting: {
      _result: '',
      _calls: [],
      async executeScript(details) {
        chrome.scripting._calls.push(details);
        return [{ result: chrome.scripting._result }];
      }
    },

    // ---- test helpers (not part of the real API) ----
    _tabs: tabsById,
    _alarms: alarms,
    _addTab(tab) {
      const t = { active: false, windowId: 1, incognito: false, ...tab };
      tabsById.set(t.id, t);
      return t;
    },
    async _activate(tabId) {
      const tab = tabsById.get(tabId);
      for (const t of tabsById.values()) if (t.windowId === tab.windowId) t.active = false;
      tab.active = true;
      await chrome.tabs.onActivated.dispatch({ tabId, windowId: tab.windowId });
    },
    async _navigate(tabId, url) {
      const tab = tabsById.get(tabId);
      tab.url = url;
      await chrome.tabs.onUpdated.dispatch(tabId, { url }, clone(tab));
    },
    async _removeTab(tabId) {
      const tab = tabsById.get(tabId);
      tabsById.delete(tabId);
      await chrome.tabs.onRemoved.dispatch(tabId, { windowId: tab?.windowId, isWindowClosing: false });
    },
    async _focusWindow(windowId) {
      focusedWindowId = windowId;
      await chrome.windows.onFocusChanged.dispatch(windowId);
    },
    async _setIdle(state) {
      idleState = state;
      await chrome.idle.onStateChanged.dispatch(state);
    },
    async _fireAlarm(name) {
      const alarm = alarms.get(name);
      if (!alarm) throw new Error(`alarm ${name} not scheduled`);
      if (!alarm.periodInMinutes) alarms.delete(name);
      await chrome.alarms.onAlarm.dispatch(clone(alarm));
    },
    // Simulates Chrome stopping the service worker: every listener (and all
    // in-memory worker state) is gone; storage and alarms survive.
    _killWorker() { for (const e of allEvents) e.listeners = []; }
  };
  return chrome;
}
