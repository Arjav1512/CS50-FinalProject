// Tracking engine for the Digital Diary service worker.
//
// Design rules (Manifest V3 service workers are stopped after ~30 s idle):
// - No tracking state lives only in memory. The active session is kept in
//   chrome.storage.session, so a fresh worker instance continues it.
// - Every read-modify-write of storage goes through ONE serial queue, so two
//   events that end sessions at the same moment can never overwrite each other.
// - Timers use chrome.alarms (survive the worker stopping), never setInterval.

import {
  withDefaults, isExcludedUrl, hostnameOf, applyRetention, migrateStorage, DEFAULT_SETTINGS,
  CATEGORIES, normalizeHostname, getCategory, productiveSecondsBetween,
  focusResultMessage, FOCUS_MIN_MINUTES, FOCUS_MAX_MINUTES, SCHEMA_VERSION
} from './core.js';

export const ALARM_FLUSH = 'flush';
export const ALARM_RETENTION = 'retention';
export const ALARM_FOCUS = 'focusEnd';
export const FOCUS_NOTIFICATION_ID = 'focus-session-complete';
// Keys that hold the user's data (as opposed to settings).
export const DATA_KEYS = ['activityLog', 'summaries', 'categoryOverrides', 'focusSession', 'migrationReport'];
// No keyboard/mouse input for this long = "idle". 120 s so slow reading is not
// cut off; the idle time itself is never counted (the end time is backdated by
// this interval), so a longer interval adds nothing when the user walks away.
export const IDLE_DETECTION_SECONDS = 120;
// Alarms fire every minute while Chrome runs. A much larger gap since the last
// flush means the computer slept or Chrome was suspended; that time is not counted.
export const SUSPEND_GAP_MS = 3 * 60 * 1000;

const SESSION_KEY = 'activeSession';

export function createSerialQueue(onError = err => console.error('[Digital Diary]', err)) {
  let tail = Promise.resolve();
  return function run(task) {
    const result = tail.then(task);
    tail = result.catch(onError);
    return result;
  };
}

export function createTracker(chrome) {
  const run = createSerialQueue();

  // ---------- storage helpers (call only from inside run()) ----------
  async function getSettings() {
    return withDefaults(await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS)));
  }

  async function getSession() {
    return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] || null;
  }

  async function setSession(session) {
    if (session) await chrome.storage.session.set({ [SESSION_KEY]: session });
    else await chrome.storage.session.remove(SESSION_KEY);
  }

  async function upsertEntries(entries) {
    const { activityLog = [] } = await chrome.storage.local.get('activityLog');
    for (const entry of entries) {
      const i = activityLog.findIndex(e => e.id !== undefined && e.id === entry.id);
      if (i >= 0) activityLog[i] = entry;
      else activityLog.push(entry);
    }
    await chrome.storage.local.set({ activityLog });
  }

  // Writes the session's elapsed time (startTime → until) into its log entry.
  // The same entry is updated on every flush, so the log does not fill up with
  // one-minute fragments.
  async function recordSession(session, until, settings) {
    const seconds = Math.max(0, Math.round((until - session.startTime) / 1000));
    if (!session.logged && seconds < settings.minTrackingTime) return session;
    await upsertEntries([{
      id: session.id,
      domain: session.domain,
      url: session.url,
      when: session.startTime,
      timeSpent: seconds
    }]);
    return { ...session, logged: true, lastSeen: until };
  }

  async function endSession(until = Date.now()) {
    const session = await getSession();
    if (!session) return null;
    const settings = await getSettings();
    let end = Math.max(session.startTime, Math.min(until, Date.now()));
    // The flush alarm refreshes lastSeen every minute while Chrome is running.
    // A much older lastSeen means the computer slept or Chrome was suspended:
    // count only up to one alarm period after the last sign of life.
    const lastSeen = session.lastSeen ?? session.startTime;
    if (end - lastSeen > SUSPEND_GAP_MS) end = lastSeen + 60000;
    await recordSession(session, end, settings);
    await setSession(null);
    return session;
  }

  async function startSession(tab, extra = {}) {
    if (!tab || !tab.url || tab.incognito) return null;
    const settings = await getSettings();
    if (isExcludedUrl(tab.url, settings.excludedDomains)) return null;
    const now = Date.now();
    const session = {
      id: `${now.toString(36)}-${tab.id}-${Math.random().toString(36).slice(2, 8)}`,
      tabId: tab.id,
      url: tab.url,
      domain: hostnameOf(tab.url),
      startTime: now,
      lastSeen: now,
      logged: false,
      ...extra
    };
    await setSession(session);
    return session;
  }

  async function focusedWindow() {
    const win = await chrome.windows.getLastFocused().catch(() => null);
    return win && win.focused ? win : null;
  }

  // Ends whatever is being tracked and starts tracking `tab` — but only if it
  // is the active tab of the focused Chrome window. (A tab can be activated in
  // the background, e.g. when a popup window closes itself while the user is
  // in another app; that must not start counting time.)
  async function switchTo(tab) {
    const current = await getSession();
    if (current && tab && current.tabId === tab.id && current.url === tab.url) return;
    await endSession();
    const win = await focusedWindow();
    if (tab && win && win.id === tab.windowId) await startSession(tab);
  }

  // Starts a session for the active tab of the focused window when nothing is
  // being tracked: when the user is active (e.g. right after browser start), or
  // while idle if that tab is playing sound (e.g. the next autoplay video after
  // a silent gap ended the previous session). Never while the screen is locked.
  async function resumeIfNeeded() {
    if (await getSession()) return;
    const state = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
    if (state === 'locked') return;
    const win = await focusedWindow();
    if (!win) return;
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (state === 'active') await startSession(tab);
    else if (tab && tab.audible) await startSession(tab, { audibleWhileIdle: true });
  }

  // Is the tracked tab playing sound (video, podcast, music)? Playing media
  // involves no keyboard/mouse input, so "idle" alone must not end the visit.
  async function isAudible(session) {
    const tab = await chrome.tabs.get(session.tabId).catch(() => null);
    return !!(tab && tab.audible);
  }

  async function flush() {
    let session = await getSession();
    if (!session) return resumeIfNeeded();
    const now = Date.now();
    const state = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
    if (state === 'locked') {
      await endSession(now);
      return;
    }
    if (state === 'idle') {
      if (await isAudible(session)) {
        session = { ...session, audibleWhileIdle: true };      // keep counting
      } else if (session.audibleWhileIdle) {
        // Audio was keeping an idle session alive and has stopped since the
        // last flush: end it now.
        await endSession(now);
        return;
      } else {
        // Missed "idle" event safety net: the idle interval is not counted.
        await endSession(now - IDLE_DETECTION_SECONDS * 1000);
        return;
      }
    } else if (session.audibleWhileIdle) {
      session = { ...session, audibleWhileIdle: false };       // user is back
    }
    if (now - (session.lastSeen ?? session.startTime) > SUSPEND_GAP_MS) {
      // Computer slept / Chrome suspended (see endSession), then start fresh.
      await endSession(now);
      await resumeIfNeeded();
      return;
    }
    const settings = await getSettings();
    // Still the active tab of the focused window, and not (newly) excluded?
    const win = await focusedWindow();
    const [active] = win ? await chrome.tabs.query({ active: true, windowId: win.id }) : [];
    if (!active || active.id !== session.tabId || active.url !== session.url ||
        isExcludedUrl(session.url, settings.excludedDomains)) {
      await switchTo(active || null);
      return;
    }
    const updated = await recordSession(session, now, settings);
    await setSession({ ...updated, lastSeen: now });
  }

  // Excluded Domains changed: stop timing the current page right away if it is
  // now excluded.
  async function recheckExclusion() {
    const session = await getSession();
    if (!session) return;
    const settings = await getSettings();
    if (isExcludedUrl(session.url, settings.excludedDomains)) await endSession();
  }

  async function applyRetentionNow() {
    const settings = await getSettings();
    const days = Number(settings.dataRetention) || 0;
    if (days <= 0) return { removedActivities: 0, removedSummaries: 0 };
    const { activityLog = [], summaries = [] } = await chrome.storage.local.get(['activityLog', 'summaries']);
    const keptLog = applyRetention(activityLog, days, Date.now(), 'when');
    const keptSummaries = applyRetention(summaries, days, Date.now(), 'time');
    const removedActivities = activityLog.length - keptLog.length;
    const removedSummaries = summaries.length - keptSummaries.length;
    if (removedActivities || removedSummaries) {
      await chrome.storage.local.set({ activityLog: keptLog, summaries: keptSummaries });
    }
    return { removedActivities, removedSummaries };
  }

  // Converts data written by version 1.0 (see core.migrateStorage). Safe to
  // call on every start: it does nothing once schemaVersion is current.
  async function migrateIfNeeded() {
    const data = await chrome.storage.local.get(null);
    const result = migrateStorage(data, Date.now());
    if (!result) return null;
    await chrome.storage.local.set(result.set);
    if (result.remove.length) await chrome.storage.local.remove(result.remove);
    const r = result.report;
    console.log(`[Digital Diary] Migrated data to schema ${r.to}: ${r.converted}/${r.total} visit timestamps converted.`);
    if (r.unparsed || r.summariesUnparsed) {
      console.warn(`[Digital Diary] Kept ${r.unparsed} visits and ${r.summariesUnparsed} summaries whose date could not be read (not deleted).`);
    }
    return r;
  }

  async function ensureAlarms() {
    if (!(await chrome.alarms.get(ALARM_FLUSH))) {
      await chrome.alarms.create(ALARM_FLUSH, { periodInMinutes: 1 });
    }
    if (!(await chrome.alarms.get(ALARM_RETENTION))) {
      await chrome.alarms.create(ALARM_RETENTION, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
    }
    // A focus session that was running when the browser closed.
    const { focusSession } = await chrome.storage.local.get('focusSession');
    if (focusSession?.active && !(await chrome.alarms.get(ALARM_FOCUS))) {
      await chrome.alarms.create(ALARM_FOCUS, { when: Math.max(focusSession.endTime, Date.now() + 1000) });
    }
  }

  // ---------- focus sessions (timer lives here, not in the popup) ----------
  async function startFocus(minutes) {
    const m = Math.round(Number(minutes));
    if (!Number.isFinite(m) || m < FOCUS_MIN_MINUTES || m > FOCUS_MAX_MINUTES) {
      return { ok: false, error: `Choose between ${FOCUS_MIN_MINUTES} and ${FOCUS_MAX_MINUTES} minutes.` };
    }
    const startTime = Date.now();
    const focusSession = { active: true, startTime, endTime: startTime + m * 60000, duration: m * 60 };
    await chrome.storage.local.set({ focusSession });
    await chrome.alarms.create(ALARM_FOCUS, { when: focusSession.endTime });
    return { ok: true, focusSession };
  }

  async function stopFocus() {
    await chrome.alarms.clear(ALARM_FOCUS);
    const { focusSession } = await chrome.storage.local.get('focusSession');
    if (!focusSession?.active) return { ok: true };
    const stopped = { ...focusSession, active: false, stopped: true, stoppedAt: Date.now() };
    await chrome.storage.local.set({ focusSession: stopped });
    return { ok: true, focusSession: stopped };
  }

  async function completeFocus() {
    const { focusSession } = await chrome.storage.local.get('focusSession');
    if (!focusSession?.active) return null;
    await flush(); // bring the log up to date first
    const { activityLog = [], categoryOverrides = {} } = await chrome.storage.local.get(['activityLog', 'categoryOverrides']);
    const productiveSeconds = productiveSecondsBetween(activityLog, focusSession.startTime, focusSession.endTime, categoryOverrides);
    const done = { ...focusSession, active: false, completed: true, productiveSeconds };
    await chrome.storage.local.set({ focusSession: done });
    const settings = await getSettings();
    if (settings.enableNotifications) {
      await chrome.notifications.create(FOCUS_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Focus session complete',
        message: focusResultMessage(productiveSeconds, focusSession.duration)
      });
    }
    return done;
  }

  // ---------- data actions requested by the popup / options page ----------
  async function setCategory(domain, category) {
    const host = normalizeHostname(domain);
    if (!host || !CATEGORIES.includes(category)) return { ok: false, error: 'Unknown site or category.' };
    const { categoryOverrides = {} } = await chrome.storage.local.get('categoryOverrides');
    delete categoryOverrides[host];
    // Choosing the built-in category removes the override instead of storing a copy.
    if (getCategory(host, categoryOverrides) !== category) categoryOverrides[host] = category;
    await chrome.storage.local.set({ categoryOverrides });
    return { ok: true, categoryOverrides };
  }

  async function clearAllData() {
    await chrome.alarms.clear(ALARM_FOCUS);
    await chrome.storage.local.remove(DATA_KEYS);
    await chrome.storage.session.remove(SESSION_KEY);
    await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION });
    return { ok: true };
  }

  // Resets every setting EXCEPT the data-retention period: resetting it to the
  // 90-day default would make the next daily cleanup delete older history,
  // and this action promises to keep activity data.
  async function resetSettings() {
    await chrome.storage.local.remove(Object.keys(DEFAULT_SETTINGS).filter(k => k !== 'dataRetention'));
    return { ok: true };
  }

  // ---------- event handlers (each one is a single queued task) ----------
  const handlers = {
    onActivated: ({ tabId }) => run(async () => {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      await switchTo(tab);
    }),

    onUpdated: (tabId, changeInfo, tab) => {
      if (!changeInfo.url) return Promise.resolve();
      return run(async () => {
        const session = await getSession();
        if (session && session.tabId === tabId) {
          // Navigation inside the tracked tab: end the old page first, even if
          // the new URL is excluded (its time must not go to the old page).
          await switchTo(tab);
        } else if (!session && tab && tab.active) {
          await switchTo(tab);
        }
      });
    },

    onRemoved: tabId => run(async () => {
      const session = await getSession();
      if (session && session.tabId === tabId) await endSession();
    }),

    onFocusChanged: windowId => run(async () => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        await endSession();
        return;
      }
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      await switchTo(tab);
    }),

    onIdleStateChanged: state => run(async () => {
      if (state === 'idle') {
        const session = await getSession();
        if (session && await isAudible(session)) {
          // Watching/listening: keep the visit running; flush() re-checks audio.
          await setSession({ ...session, audibleWhileIdle: true });
        } else {
          // "idle" means no input for the whole detection interval: don't count it.
          await endSession(Date.now() - IDLE_DETECTION_SECONDS * 1000);
        }
      } else if (state === 'locked') {
        await endSession();
      } else {
        await resumeIfNeeded();
      }
    }),

    onStorageChanged: (changes, area) => {
      if (area !== 'local' || !changes.excludedDomains) return Promise.resolve();
      return run(recheckExclusion);
    },

    onAlarm: alarm => {
      if (alarm.name === ALARM_FLUSH) return run(flush);
      if (alarm.name === ALARM_RETENTION) return run(applyRetentionNow);
      if (alarm.name === ALARM_FOCUS) return run(completeFocus);
      return Promise.resolve();
    },

    onStartup: () => run(async () => {
      await migrateIfNeeded();
      await ensureAlarms();
      await applyRetentionNow();
      await resumeIfNeeded();
    }),

    onInstalled: () => run(async () => {
      await migrateIfNeeded();
      await ensureAlarms();
      await applyRetentionNow();
      await resumeIfNeeded();
    })
  };

  return {
    handlers,
    run,
    // Exposed for the message handler and tests; each is queued.
    logEntries: entries => run(() => upsertEntries(entries)),
    flushNow: () => run(flush),
    endSessionNow: () => run(() => endSession()),
    applyRetentionNow: () => run(applyRetentionNow),
    ensureAlarms: () => run(ensureAlarms),
    migrateIfNeeded: () => run(migrateIfNeeded),
    startFocus: minutes => run(() => startFocus(minutes)),
    stopFocus: () => run(stopFocus),
    setCategory: (domain, category) => run(() => setCategory(domain, category)),
    clearAllData: () => run(clearAllData),
    resetSettings: () => run(resetSettings),
    getSettings: () => run(getSettings)
  };
}

// Registers every listener synchronously, as MV3 requires for events to wake
// the worker. Returns the tracker so callers can add message handling.
export function registerTracker(chrome) {
  const tracker = createTracker(chrome);
  const h = tracker.handlers;
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  chrome.tabs.onActivated.addListener(h.onActivated);
  chrome.tabs.onUpdated.addListener(h.onUpdated);
  chrome.tabs.onRemoved.addListener(h.onRemoved);
  chrome.windows.onFocusChanged.addListener(h.onFocusChanged);
  chrome.idle.onStateChanged.addListener(h.onIdleStateChanged);
  chrome.alarms.onAlarm.addListener(h.onAlarm);
  chrome.storage.onChanged.addListener(h.onStorageChanged);
  chrome.runtime.onStartup.addListener(h.onStartup);
  chrome.runtime.onInstalled.addListener(h.onInstalled);
  // Queued first, so no event is handled before old data has been migrated.
  tracker.migrateIfNeeded();
  // Alarms can be lost across browser restarts; re-create them on every start.
  tracker.ensureAlarms();
  return tracker;
}
