import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateStreak, generateAchievements } from '../../lib/core.js';

const NOW = new Date(2026, 10, 20, 18, 0, 0).getTime();   // Friday 20 Nov 2026, 18:00
const at = (daysAgo, hour = 10) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.getTime(); };
const visit = (daysAgo, minutes, domain = 'wikipedia.org') => ({ domain, when: at(daysAgo), timeSpent: minutes * 60 });

test('streak needs consecutive calendar days: Monday + Friday is not a 2-day streak', () => {
  const log = [visit(4, 40), visit(0, 40)];                // Mon and Fri
  const s = calculateStreak(log, { goalMinutes: 30, now: NOW });
  assert.equal(s.current, 1);
  assert.equal(s.longest, 1);
});

test('a gap day breaks the streak; longest is tracked separately', () => {
  const log = [visit(6, 40), visit(5, 40), visit(4, 40), /* gap at 3 */ visit(2, 40), visit(1, 40), visit(0, 40)];
  const s = calculateStreak(log, { goalMinutes: 30, now: NOW });
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
});

test('if today has not reached the goal yet, the streak still counts up to yesterday', () => {
  const log = [visit(3, 40), visit(2, 40), visit(1, 40), visit(0, 10)];
  const s = calculateStreak(log, { goalMinutes: 30, now: NOW });
  assert.equal(s.current, 3);
  assert.equal(s.todayDone, false);
});

test('streakGoal setting is respected and only learning/productive time counts', () => {
  const log = [visit(1, 40), visit(0, 40), visit(0, 500, 'youtube.com')];
  assert.equal(calculateStreak(log, { goalMinutes: 30, now: NOW }).current, 2);
  assert.equal(calculateStreak(log, { goalMinutes: 45, now: NOW }).current, 0);
  // With an override, the entertainment site counts.
  assert.equal(calculateStreak(log, { goalMinutes: 45, overrides: { 'youtube.com': 'learning' }, now: NOW }).current, 1);
});

test('several visits on one day add up; unreadable timestamps are ignored, not fatal', () => {
  const log = [visit(0, 20), visit(0, 15), { domain: 'wikipedia.org', when: 'garbled', timeSpent: 99999 }];
  assert.equal(calculateStreak(log, { goalMinutes: 30, now: NOW }).current, 1);
});

test('achievements use overrides and numeric timestamps', () => {
  const log = [{ domain: 'youtube.com', when: at(0, 8), timeSpent: 3600 }];
  const streak = calculateStreak(log, { now: NOW });
  const plain = Object.fromEntries(generateAchievements(log, streak, {}, NOW).map(a => [a.id, a.unlocked]));
  assert.equal(plain.productive_hour, false);
  const over = Object.fromEntries(generateAchievements(log, streak, { 'youtube.com': 'productive' }, NOW).map(a => [a.id, a.unlocked]));
  assert.equal(over.productive_hour, true);
  assert.equal(over.early_bird, true);
});
