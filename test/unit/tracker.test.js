import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from '../helpers/chrome-mock.js';
import { createTracker, ALARM_FLUSH, ALARM_RETENTION } from '../../lib/tracker.js';

const T0 = new Date(2026, 10, 20, 9, 0, 0).getTime();
let instance = 0;

const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const advance = seconds => mock.timers.tick(seconds * 1000);
const getLog = async chrome => (await chrome.storage.local.get('activityLog')).activityLog || [];
const getSession = async chrome => (await chrome.storage.session.get('activeSession')).activeSession;
const secondsFor = (log, domain) => log.filter(e => e.domain === domain).reduce((t, e) => t + e.timeSpent, 0);

// Boots the real service-worker module against the mock. Each call creates a
// fresh module instance, i.e. a brand-new worker with empty memory.
async function bootWorker(chrome) {
  globalThis.chrome = chrome;
  await import(`../../trackingtabs.js?worker=${++instance}`);
  await settle();
}

function setupBrowser() {
  const chrome = createChromeMock();
  chrome._addTab({ id: 1, url: 'https://www.youtube.com/watch?v=1' });
  chrome._addTab({ id: 2, url: 'https://en.wikipedia.org/wiki/Chrome' });
  chrome._addTab({ id: 3, url: 'https://docs.google.com/document/d/1' });
  return chrome;
}

beforeEach(() => mock.timers.enable({ apis: ['Date'], now: T0 }));
afterEach(() => mock.timers.reset());

test('worker restart mid-session: logged duration within ±5 s of real time', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(50);

  chrome._killWorker();                    // Chrome stops the worker: memory gone
  assert.ok(await getSession(chrome), 'session survives in storage.session');
  await bootWorker(chrome);                // a new worker instance starts

  advance(70);
  await chrome._fireAlarm(ALARM_FLUSH);    // the minute alarm wakes the new worker
  let log = await getLog(chrome);
  assert.ok(Math.abs(secondsFor(log, 'youtube.com') - 120) <= 5, `flushed ${secondsFor(log, 'youtube.com')}s`);

  advance(10);
  await chrome._activate(2);
  log = await getLog(chrome);
  const yt = log.filter(e => e.domain === 'youtube.com');
  assert.equal(yt.length, 1, 'one entry, updated in place');
  assert.ok(Math.abs(yt[0].timeSpent - 130) <= 5, `final ${yt[0].timeSpent}s, real 130s`);
});

test('worker restart without any alarm: next tab switch still logs the full visit', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(40);
  chrome._killWorker();
  advance(45);
  await bootWorker(chrome);
  await chrome._activate(2);
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 85);
});

test('window focus loss and regain: away time is not counted, tracking resumes', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(30);
  await chrome._focusWindow(chrome.windows.WINDOW_ID_NONE);   // alt-tab away
  assert.equal(await getSession(chrome), undefined);
  advance(60);
  await chrome._focusWindow(1);                                // come back (no exception)
  const resumed = await getSession(chrome);
  assert.equal(resumed?.tabId, 1, 'tracking resumes on the active tab');
  advance(20);
  await chrome._activate(2);
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 50, '30 s + 20 s, not 110 s');
});

test('idle then active: idle time (including the 60 s detection window) is not counted', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  assert.equal(chrome.idle._detectionInterval, 60);
  await chrome._activate(1);
  advance(100);                          // user stopped touching the computer at t=40 s
  await chrome._setIdle('idle');         // Chrome reports idle 60 s later
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 40);
  assert.equal(await getSession(chrome), undefined);
  advance(300);
  await chrome._setIdle('active');
  assert.equal((await getSession(chrome))?.tabId, 1, 'new session on return');
  advance(30);
  await chrome._fireAlarm(ALARM_FLUSH);
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 70, '40 s + 30 s, not 430 s');
});

test('screen locked ends the session immediately', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(25);
  await chrome._setIdle('locked');
  advance(600);
  await chrome._fireAlarm(ALARM_FLUSH);
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 25);
});

test('two sessions ending at the same moment are both saved', async () => {
  const chrome = setupBrowser();
  const tracker = createTracker(chrome);
  await Promise.all([
    tracker.logEntries([{ id: 'a', domain: 'a.com', url: 'https://a.com/', when: T0, timeSpent: 10 }]),
    tracker.logEntries([{ id: 'b', domain: 'b.com', url: 'https://b.com/', when: T0, timeSpent: 20 }])
  ]);
  assert.deepEqual((await getLog(chrome)).map(e => e.id).sort(), ['a', 'b']);

  // Many simultaneous writers.
  await Promise.all(Array.from({ length: 25 }, (_, i) =>
    tracker.logEntries([{ id: `n${i}`, domain: 'n.com', url: 'https://n.com/', when: T0, timeSpent: 1 }])));
  assert.equal((await getLog(chrome)).length, 27);
});

test('simultaneous events for the same session produce exactly one correct entry', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(15);
  await chrome._activate(2);             // session A (youtube) ends
  advance(12);
  // Session B (wikipedia) is ended by three events firing at the same moment.
  await Promise.all([
    chrome._focusWindow(chrome.windows.WINDOW_ID_NONE),
    chrome._removeTab(2),
    chrome._fireAlarm(ALARM_FLUSH)
  ]);
  const log = await getLog(chrome);
  assert.equal(secondsFor(log, 'youtube.com'), 15);
  const wiki = log.filter(e => e.domain === 'en.wikipedia.org');
  assert.equal(wiki.length, 1);
  assert.equal(wiki[0].timeSpent, 12);
});

test('minute flush saves progress so a crash loses at most about a minute', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  const alarm = await chrome.alarms.get(ALARM_FLUSH);
  assert.equal(alarm.periodInMinutes, 1);
  await chrome._activate(1);
  advance(61);
  await chrome._fireAlarm(ALARM_FLUSH);
  advance(61);
  await chrome._fireAlarm(ALARM_FLUSH);
  // Browser crashes now: storage.session is wiped, nothing else runs.
  await chrome.storage.session.clear();
  assert.equal(secondsFor(await getLog(chrome), 'youtube.com'), 122);
});

test('navigating the tracked tab to an excluded site ends the previous page first', async () => {
  const chrome = setupBrowser();
  await chrome.storage.local.set({ excludedDomains: ['wikipedia.org'] });
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(20);
  await chrome._navigate(1, 'https://en.wikipedia.org/wiki/Privacy');
  assert.equal(await getSession(chrome), undefined, 'excluded page is not tracked');
  advance(30);
  await chrome._fireAlarm(ALARM_FLUSH);
  const log = await getLog(chrome);
  assert.equal(secondsFor(log, 'youtube.com'), 20);
  assert.equal(log.some(e => e.domain.includes('wikipedia')), false);
});

test('browser startup tracks the already-active tab without a tab switch', async () => {
  const chrome = setupBrowser();
  chrome._tabs.get(3).active = true;
  await bootWorker(chrome);
  await chrome.runtime.onStartup.dispatch();
  assert.equal((await getSession(chrome))?.tabId, 3);
});

test('navigation in the active tab starts tracking even if it was never activated', async () => {
  const chrome = setupBrowser();
  chrome._tabs.get(1).active = true;
  await bootWorker(chrome);
  await chrome._navigate(1, 'https://www.reddit.com/r/all');
  assert.equal((await getSession(chrome))?.domain, 'reddit.com');
});

test('a long gap between flushes (computer asleep) is not counted', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  await chrome._activate(1);
  advance(60);
  await chrome._fireAlarm(ALARM_FLUSH);
  advance(3600);                         // laptop lid closed for an hour
  await chrome._fireAlarm(ALARM_FLUSH);
  const total = secondsFor(await getLog(chrome), 'youtube.com');
  assert.ok(total <= 125, `counted ${total}s`);
});

test('incognito tabs and short visits are not logged', async () => {
  const chrome = setupBrowser();
  chrome._addTab({ id: 9, url: 'https://secret.example/', incognito: true });
  await bootWorker(chrome);
  await chrome._activate(9);
  advance(100);
  await chrome._activate(1);
  advance(3);                            // below the 5 s minimum
  await chrome._activate(2);
  const log = await getLog(chrome);
  assert.equal(log.length, 0, JSON.stringify(log));
});

test('alarms are registered on worker start', async () => {
  const chrome = setupBrowser();
  await bootWorker(chrome);
  assert.equal((await chrome.alarms.get(ALARM_FLUSH)).periodInMinutes, 1);
  assert.equal((await chrome.alarms.get(ALARM_RETENTION)).periodInMinutes, 1440);
});

test('daily retention alarm removes old entries but keeps recent and unreadable ones', async () => {
  const chrome = setupBrowser();
  const day = 86400000;
  await chrome.storage.local.set({
    schemaVersion: 2,
    dataRetention: 30,
    activityLog: [
      { id: 'old', domain: 'a.com', when: T0 - 40 * day, timeSpent: 10 },
      { id: 'new', domain: 'b.com', when: T0 - 2 * day, timeSpent: 10 },
      { id: 'bad', domain: 'c.com', when: 'not a date', timeSpent: 10 }
    ],
    summaries: [
      { url: 'https://a.com/', summary: 'x', time: T0 - 40 * day },
      { url: 'https://b.com/', summary: 'y', time: T0 - day }
    ]
  });
  await bootWorker(chrome);
  await chrome._fireAlarm(ALARM_RETENTION);
  const { activityLog, summaries } = await chrome.storage.local.get(['activityLog', 'summaries']);
  assert.deepEqual(activityLog.map(e => e.id), ['new', 'bad']);
  assert.equal(summaries.length, 1);

  // "Keep forever" deletes nothing.
  await chrome.storage.local.set({ dataRetention: 0, activityLog: [{ id: 'ancient', when: 0, timeSpent: 1 }] });
  await chrome._fireAlarm(ALARM_RETENTION);
  assert.equal((await getLog(chrome)).length, 1);
});
