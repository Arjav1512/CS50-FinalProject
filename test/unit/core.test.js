import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../lib/core.js';

test('formatTime renders seconds, minutes and hours', () => {
  assert.equal(core.formatTime(0), '0s');
  assert.equal(core.formatTime(59), '59s');
  assert.equal(core.formatTime(60), '1m');
  assert.equal(core.formatTime(3599), '59m');
  assert.equal(core.formatTime(3600), '1h');
  assert.equal(core.formatTime(3660), '1h 1m');
  assert.equal(core.formatTime(90.4), '1m', 'fractional seconds are rounded');
});

test('productivity score weights categories by time', () => {
  assert.equal(core.calculateProductivityScore([]), 0);
  assert.equal(core.calculateProductivityScore([{ domain: 'wikipedia.org', timeSpent: 100 }]), 100);
  assert.equal(core.calculateProductivityScore([{ domain: 'youtube.com', timeSpent: 100 }]), 20);
});

test('getDateRange("today") starts at local midnight', () => {
  const now = new Date(2026, 10, 22, 15, 30);
  const { start, end } = core.getDateRange('today', now);
  assert.equal(start.getTime(), new Date(2026, 10, 22).getTime());
  assert.equal(end, now);
});
