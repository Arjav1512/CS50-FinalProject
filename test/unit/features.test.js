import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from '../helpers/chrome-mock.js';
import { ALARM_FOCUS, ALARM_FLUSH } from '../../lib/tracker.js';
import {
  getDateRange, buildReportText, buildDailySummaryText, productiveSecondsBetween, SCHEMA_VERSION
} from '../../lib/core.js';
import { pickProperties, buildPageBody, exportToNotion, normalizeDatabaseId, chunkText } from '../../lib/notion.js';

const T0 = new Date(2026, 10, 20, 9, 0, 0).getTime();
let n = 0;
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(r => setImmediate(r)); };
const advance = s => mock.timers.tick(s * 1000);

async function boot(chrome) {
  globalThis.chrome = chrome;
  await import(`../../trackingtabs.js?features=${++n}`);
  await settle();
}
const send = (chrome, msg) => chrome.runtime.sendMessage(msg);
// Real Chrome fires the flush alarm every minute while the user browses.
async function browse(chrome, seconds) {
  for (let left = seconds; left > 0; left -= 60) {
    advance(Math.min(60, left));
    if (left >= 60) await chrome._fireAlarm(ALARM_FLUSH);
  }
}

function browser() {
  const chrome = createChromeMock();
  chrome._addTab({ id: 1, url: 'https://en.wikipedia.org/wiki/Focus' });
  chrome._addTab({ id: 2, url: 'https://www.youtube.com/watch?v=x' });
  return chrome;
}

beforeEach(() => mock.timers.enable({ apis: ['Date'], now: T0 }));
afterEach(() => mock.timers.reset());

// ---------------------------------------------------------------- focus

test('focus session runs in the worker (alarm) and notifies with productive minutes', async () => {
  const chrome = browser();
  await boot(chrome);
  const started = await send(chrome, { type: 'startFocus', minutes: 25 });
  assert.equal(started.ok, true);
  const alarm = await chrome.alarms.get(ALARM_FOCUS);
  assert.equal(alarm.scheduledTime, T0 + 25 * 60000, 'alarm, not a popup setTimeout');

  // The popup is closed; the user browses: 10 min learning, 5 min entertainment, then 10 min learning.
  await chrome._activate(1); await browse(chrome, 600);
  await chrome._activate(2); await browse(chrome, 300);
  await chrome._activate(1); await browse(chrome, 600);
  await chrome._fireAlarm(ALARM_FOCUS);

  const { focusSession } = await chrome.storage.local.get('focusSession');
  assert.equal(focusSession.active, false);
  assert.equal(focusSession.completed, true);
  assert.equal(focusSession.productiveSeconds, 1200);
  assert.equal(chrome.notifications._created.length, 1);
  const note = chrome.notifications._created[0];
  assert.equal(note.message, '20 of 25 minutes were spent on learning/productive sites.');
  assert.equal(note.iconUrl, 'icons/icon128.png');
});

test('focus notification respects "Notify me when a focus session ends" and overrides', async () => {
  const chrome = browser();
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION, enableNotifications: false, categoryOverrides: { 'youtube.com': 'learning' } });
  await boot(chrome);
  await send(chrome, { type: 'startFocus', minutes: 5 });
  await chrome._activate(2); await browse(chrome, 300);
  await chrome._fireAlarm(ALARM_FOCUS);
  const { focusSession } = await chrome.storage.local.get('focusSession');
  assert.equal(focusSession.productiveSeconds, 300, 'override makes youtube count');
  assert.equal(chrome.notifications._created.length, 0);
});

test('focus session: invalid durations refused; stop clears the alarm', async () => {
  const chrome = browser();
  await boot(chrome);
  assert.equal((await send(chrome, { type: 'startFocus', minutes: 2 })).ok, false);
  assert.equal((await send(chrome, { type: 'startFocus', minutes: 999 })).ok, false);
  await send(chrome, { type: 'startFocus', minutes: 30 });
  await send(chrome, { type: 'stopFocus' });
  assert.equal(await chrome.alarms.get(ALARM_FOCUS), undefined);
  const { focusSession } = await chrome.storage.local.get('focusSession');
  assert.equal(focusSession.active, false);
  assert.equal(focusSession.stopped, true);
});

test('a focus session still running after a browser restart gets its alarm back', async () => {
  const chrome = browser();
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION, focusSession: { active: true, startTime: T0, endTime: T0 + 600000, duration: 600 } });
  await boot(chrome);
  assert.ok(await chrome.alarms.get(ALARM_FOCUS));
});

test('productiveSecondsBetween counts only the overlapping part of visits', () => {
  const log = [
    { domain: 'wikipedia.org', when: 0, timeSpent: 100 },     // 0–100 s
    { domain: 'wikipedia.org', when: 150000, timeSpent: 100 }, // 150–250 s
    { domain: 'youtube.com', when: 0, timeSpent: 1000 }
  ];
  assert.equal(productiveSecondsBetween(log, 50000, 200000), 100);
});

// ---------------------------------------------------------------- data actions

test('changing a site category from the popup stores an override; choosing the built-in removes it', async () => {
  const chrome = browser();
  await boot(chrome);
  await send(chrome, { type: 'setCategory', domain: 'www.youtube.com', category: 'learning' });
  assert.deepEqual((await chrome.storage.local.get('categoryOverrides')).categoryOverrides, { 'youtube.com': 'learning' });
  await send(chrome, { type: 'setCategory', domain: 'youtube.com', category: 'entertainment' });
  assert.deepEqual((await chrome.storage.local.get('categoryOverrides')).categoryOverrides, {});
  assert.equal((await send(chrome, { type: 'setCategory', domain: 'a.com', category: 'nonsense' })).ok, false);
});

test('Clear All Data removes data but keeps settings; Reset Settings keeps data', async () => {
  const chrome = browser();
  await chrome.storage.local.set({
    schemaVersion: SCHEMA_VERSION, activityLog: [{ id: 'a', domain: 'a.com', when: T0, timeSpent: 9 }],
    summaries: [{ url: 'https://a.com', summary: 's', time: T0 }], categoryOverrides: { 'a.com': 'learning' },
    streakGoal: 60, geminiApiKey: 'k', theme: 'light'
  });
  await boot(chrome);
  await chrome._activate(1);
  await send(chrome, { type: 'clearAllData' });
  let data = await chrome.storage.local.get(null);
  assert.equal(data.activityLog, undefined);
  assert.equal(data.summaries, undefined);
  assert.equal(data.categoryOverrides, undefined);
  assert.equal(data.streakGoal, 60);
  assert.equal(data.geminiApiKey, 'k');
  assert.equal((await chrome.storage.session.get('activeSession')).activeSession, undefined, 'running visit discarded too');

  await chrome.storage.local.set({ activityLog: [{ id: 'b', domain: 'b.com', when: T0, timeSpent: 9 }], dataRetention: 0 });
  await send(chrome, { type: 'resetSettings' });
  data = await chrome.storage.local.get(null);
  assert.equal(data.activityLog.length, 1);
  assert.equal(data.streakGoal, undefined);
  assert.equal(data.geminiApiKey, undefined);
  assert.equal(data.theme, undefined);
  assert.equal(data.dataRetention, 0, 'retention period is kept (review finding)');
});

test('Reset All Settings never causes old history to be deleted later (review finding)', async () => {
  const chrome = browser();
  const day = 86400000;
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION, dataRetention: 0,
    activityLog: [{ id: 'ancient', domain: 'a.com', when: T0 - 200 * day, timeSpent: 5 }] });
  await boot(chrome);
  await send(chrome, { type: 'resetSettings' });
  await chrome.runtime.onStartup.dispatch();
  await chrome._fireAlarm('retention');
  assert.equal((await chrome.storage.local.get('activityLog')).activityLog.length, 1);
});

test('Clear Old Data uses the saved retention period and reports what it removed', async () => {
  const chrome = browser();
  const day = 86400000;
  await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION, dataRetention: 30, activityLog: [
    { id: 'old', domain: 'a.com', when: T0 - 31 * day, timeSpent: 1 }, { id: 'new', domain: 'a.com', when: T0, timeSpent: 1 }] });
  await boot(chrome);
  const result = await send(chrome, { type: 'clearOldData' });
  assert.equal(result.removedActivities, 1);
  assert.deepEqual((await chrome.storage.local.get('activityLog')).activityLog.map(e => e.id), ['new']);
});

// ---------------------------------------------------------------- reports

test('custom date range: inclusive whole days, validated', () => {
  const now = new Date(2026, 10, 20, 12);
  const r = getDateRange('custom', now, { start: '2026-11-01', end: '2026-11-03' });
  assert.equal(r.start.getTime(), new Date(2026, 10, 1).getTime());
  assert.equal(r.end.getTime(), new Date(2026, 10, 3, 23, 59, 59, 999).getTime());
  assert.match(getDateRange('custom', now, { start: '2026-11-05', end: '2026-11-03' }).error, /on or before/);
  assert.match(getDateRange('custom', now, { start: '', end: '2026-11-03' }).error, /both/);
});

test('report text and Notion summary text come from the shared module', () => {
  const log = [{ domain: 'wikipedia.org', when: T0, timeSpent: 3600 }, { domain: 'youtube.com', when: T0, timeSpent: 1800 }];
  const report = buildReportText(log, { label: 'Custom Range', start: new Date(2026, 10, 1), end: new Date(2026, 10, 20) });
  assert.match(report, /DIGITAL DIARY REPORT/);
  assert.match(report, /Period: Custom Range/);
  assert.match(report, /learning\s+1h \(66\.7%\)/);
  assert.match(report, /youtube\.com\s+30m \[entertainment\]/);
  const daily = buildDailySummaryText(log, [{ url: 'https://a.com/x', title: 'An article', summary: '• point' }]);
  assert.match(daily, /Total Time Tracked: 1h 30m/);
  assert.match(daily, /An article: • point/);
});

// ---------------------------------------------------------------- Notion

const NEW_DB_SCHEMA = { properties: { Name: { type: 'title' }, Tags: { type: 'multi_select' } }, title: [{ plain_text: 'Diary' }] };

test('Notion: title property is whichever has type "title" ("Name" in new databases)', () => {
  assert.deepEqual(pickProperties(NEW_DB_SCHEMA.properties), { title: 'Name', date: null, score: null });
  assert.deepEqual(pickProperties({ Title: { type: 'title' }, Date: { type: 'date' }, 'Productivity Score': { type: 'number' } }),
    { title: 'Title', date: 'Date', score: 'Productivity Score' });
  assert.deepEqual(pickProperties({ Name: { type: 'title' }, Date: { type: 'rich_text' } }).date, null, 'wrong type is ignored');
});

test('Notion: Date and Productivity Score only set when they exist; long text chunked to 2000 chars', () => {
  const body = buildPageBody('db', { title: 'Name', date: null, score: null }, { title: 'T', isoDate: '2026-11-20', text: 'x'.repeat(4500), score: 70 });
  assert.deepEqual(Object.keys(body.properties), ['Name']);
  assert.deepEqual(body.children.map(c => c.paragraph.rich_text[0].text.content.length), [2000, 2000, 500]);
  const full = buildPageBody('db', { title: 'Title', date: 'Date', score: 'Productivity Score' }, { title: 'T', isoDate: '2026-11-20', text: 'a\nb', score: 70 });
  assert.deepEqual(full.properties.Date, { date: { start: '2026-11-20' } });
  assert.deepEqual(full.properties['Productivity Score'], { number: 70 });
  assert.deepEqual(chunkText(''), ['']);
});

test('Notion export reads the schema first, then creates the page in that database', async () => {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/databases/')) return { ok: true, status: 200, json: async () => NEW_DB_SCHEMA };
    return { ok: true, status: 200, json: async () => ({ url: 'https://notion.so/page' }) };
  };
  const dbUrl = 'https://www.notion.so/me/0123456789abcdef0123456789abcdef?v=1';
  assert.equal(normalizeDatabaseId(dbUrl), '0123456789abcdef0123456789abcdef');
  const result = await exportToNotion(fetchFn, { apiKey: 'secret', databaseId: dbUrl, title: 'Digital Diary - today', isoDate: '2026-11-20', text: 'Summary', score: 55 });
  assert.equal(calls[0].url, 'https://api.notion.com/v1/databases/0123456789abcdef0123456789abcdef');
  assert.equal(calls[1].url, 'https://api.notion.com/v1/pages');
  const body = JSON.parse(calls[1].init.body);
  assert.deepEqual(body.properties, { Name: { title: [{ text: { content: 'Digital Diary - today' } }] } });
  assert.equal(calls[1].init.headers.Authorization, 'Bearer secret');
  assert.equal(result.url, 'https://notion.so/page');
});

test('Notion errors are reported with Notion\'s message', async () => {
  const fetchFn = async () => ({ ok: false, status: 404, json: async () => ({ message: 'Could not find database' }) });
  await assert.rejects(exportToNotion(fetchFn, { apiKey: 'k', databaseId: '0123456789abcdef0123456789abcdef', title: 't', isoDate: 'd', text: 'x', score: 1 }), /Could not find database/);
  await assert.rejects(exportToNotion(fetchFn, { apiKey: '', databaseId: 'nope', title: 't', isoDate: 'd', text: 'x', score: 1 }), /valid database ID/);
});

test('flush alarm still works alongside focus alarms', async () => {
  const chrome = browser();
  await boot(chrome);
  await send(chrome, { type: 'startFocus', minutes: 10 });
  await chrome._activate(1);
  advance(70);
  await chrome._fireAlarm(ALARM_FLUSH);
  const { activityLog } = await chrome.storage.local.get('activityLog');
  assert.equal(activityLog[0].timeSpent, 70);
});
