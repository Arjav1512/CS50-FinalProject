import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChromeMock } from '../helpers/chrome-mock.js';

test('mock storage round-trips values and isolates copies', async () => {
  const chrome = createChromeMock();
  const obj = { a: [1, 2] };
  await chrome.storage.local.set({ obj });
  obj.a.push(3);
  assert.deepEqual((await chrome.storage.local.get('obj')).obj, { a: [1, 2] });
  assert.deepEqual(await chrome.storage.local.get({ missing: 7 }), { missing: 7 });
  await chrome.storage.session.set({ s: 1 });
  assert.deepEqual(await chrome.storage.local.get(null), { obj: { a: [1, 2] } });
});

test('unsynchronised read-modify-write loses updates in the mock (so race tests are meaningful)', async () => {
  const chrome = createChromeMock();
  await chrome.storage.local.set({ list: [] });
  const append = async v => {
    const { list } = await chrome.storage.local.get('list');
    list.push(v);
    await chrome.storage.local.set({ list });
  };
  await Promise.all([append(1), append(2)]);
  const { list } = await chrome.storage.local.get('list');
  assert.equal(list.length, 1, 'naive concurrent appends overwrite each other');
});

test('killing the worker drops listeners but keeps storage and alarms', async () => {
  const chrome = createChromeMock();
  chrome.tabs.onActivated.addListener(() => {});
  await chrome.alarms.create('flush', { periodInMinutes: 1 });
  await chrome.storage.session.set({ x: 1 });
  chrome._killWorker();
  assert.equal(chrome.tabs.onActivated.hasListeners(), false);
  assert.ok(await chrome.alarms.get('flush'));
  assert.deepEqual(await chrome.storage.session.get('x'), { x: 1 });
});
