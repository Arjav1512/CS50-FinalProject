import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { migrateStorage, parseLegacyTimestamp, applyRetention, SCHEMA_VERSION } from '../../lib/core.js';
import { createChromeMock } from '../helpers/chrome-mock.js';

// Visit end times spread over many days, deliberately including days <= 12
// (where month/day order is ambiguous) and both AM and PM.
function sampleEndTimes() {
  const out = [];
  for (let i = 0; i < 60; i++) out.push(new Date(2026, i % 12, (i * 7) % 28 + 1, (i * 5) % 24, (i * 13) % 60, (i * 17) % 60).getTime());
  return out;
}

// Exactly what version 1.0 stored: `when: new Date().toLocaleString()` at visit end.
function legacyLog(locale) {
  return sampleEndTimes().map((end, i) => ({
    domain: i % 2 ? 'www.youtube.com' : 'en.wikipedia.org',
    timeSpent: 30 + i,
    when: new Date(end).toLocaleString(locale),
    url: 'https://example.com/',
    category: 'misc'
  }));
}

for (const locale of ['en-US', 'en-GB', 'en-IN']) {
  test(`migration converts ${locale} timestamps with zero entries lost`, () => {
    const log = legacyLog(locale);
    const result = migrateStorage({ activityLog: log });
    assert.equal(result.set.schemaVersion, SCHEMA_VERSION);
    assert.equal(result.set.activityLog.length, log.length, 'no entry dropped');
    assert.equal(result.report.converted, log.length);
    assert.equal(result.report.unparsed, 0);
    const ends = sampleEndTimes();
    result.set.activityLog.forEach((e, i) => {
      assert.equal(typeof e.when, 'number');
      // stored value is now the visit START: end - duration
      assert.equal(e.when, ends[i] - log[i].timeSpent * 1000, `${log[i].when} → ${new Date(e.when)}`);
      assert.equal(e.category, undefined);
    });
    assert.equal(result.set.activityLog[1].domain, 'youtube.com', 'domains normalized');
  });
}

test('ambiguous single entries fall back to AM/PM style (en-US "PM" vs en-IN "pm")', () => {
  assert.equal(new Date(parseLegacyTimestamp('3/4/2026, 3:05:09 PM')).getMonth(), 2);   // March 4
  assert.equal(new Date(parseLegacyTimestamp('4/3/2026, 3:05:09 pm')).getMonth(), 2);   // 4 March
  assert.equal(new Date(parseLegacyTimestamp('04/03/2026, 15:05:09')).getMonth(), 2);   // en-GB
});

test('unparseable entries are kept unchanged, counted, and never deleted by retention', () => {
  const log = [
    { domain: 'a.com', timeSpent: 10, when: '11/20/2026, 9:00:00 AM' },
    { domain: 'b.com', timeSpent: 10, when: 'Invalid Date' },
    { domain: 'c.com', timeSpent: 10, when: '' },
    { domain: 'd.com', timeSpent: 10 }
  ];
  const result = migrateStorage({ activityLog: log });
  assert.equal(result.set.activityLog.length, 4);
  assert.equal(result.report.converted, 1);
  assert.equal(result.report.unparsed, 3);
  assert.equal(result.set.activityLog[1].when, 'Invalid Date');
  const kept = applyRetention(result.set.activityLog, 30, new Date(2026, 11, 1).getTime());
  assert.equal(kept.length, 4, '"Clear old data" no longer deletes everything');
});

test('upgraded profiles keep all history: retention is set to "Keep forever"', () => {
  const result = migrateStorage({ activityLog: legacyLog('en-US'), dataRetention: 90 });
  assert.equal(result.set.dataRetention, 0);
  assert.equal(result.report.retentionWas, 90);
  assert.equal(migrateStorage({}).set.dataRetention, undefined, 'fresh installs keep the default');
});

test('migration removes dead settings, resets AI summaries to opt-in, and runs only once', () => {
  const result = migrateStorage({ activityLog: [], enableSummaries: true, notionTemplate: 'x', trackIncognito: true, currentGoal: {}, theme: 'light' });
  assert.equal(result.set.enableSummaries, false);
  assert.deepEqual(result.remove.sort(), ['currentGoal', 'notionTemplate', 'trackIncognito']);
  assert.equal(migrateStorage({ schemaVersion: SCHEMA_VERSION, activityLog: [{ when: 'x' }] }), null);
});

test('the service worker migrates 1.0 data on update and logs how many entries it kept', async () => {
  mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 21, 12).getTime() });
  const warn = mock.method(console, 'warn', () => {});
  const info = mock.method(console, 'log', () => {});
  try {
    const chrome = createChromeMock();
    const log = [...legacyLog('en-IN'), { domain: 'x.com', timeSpent: 5, when: '??' }];
    await chrome.storage.local.set({ activityLog: log, summaries: [{ url: 'https://a/', summary: 'No summary available.', time: '21/11/2026, 10:00:00 am' }] });
    globalThis.chrome = chrome;
    await import('../../trackingtabs.js?migration-test');
    await chrome.runtime.onInstalled.dispatch({ reason: 'update', previousVersion: '1.0' });
    const data = await chrome.storage.local.get(null);
    assert.equal(data.schemaVersion, SCHEMA_VERSION);
    assert.equal(data.activityLog.length, log.length, 'every entry survived');
    assert.equal(data.activityLog.filter(e => typeof e.when === 'number').length, log.length - 1);
    assert.equal(data.migrationReport.unparsed, 1);
    assert.equal(typeof data.summaries[0].time, 'number');
    assert.ok(warn.mock.calls.some(c => /Kept 1 visits/.test(c.arguments[0])), 'unparsed count is logged');
  } finally {
    warn.mock.restore();
    info.mock.restore();
    mock.timers.reset();
  }
});
