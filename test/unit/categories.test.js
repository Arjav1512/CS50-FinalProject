import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHostname, getCategory, hostnameOf, isExcludedUrl, calculateProductivityScore } from '../../lib/core.js';

test('hostname normalization strips www. and m. and lowercases', () => {
  assert.equal(normalizeHostname('www.youtube.com'), 'youtube.com');
  assert.equal(normalizeHostname('m.youtube.com'), 'youtube.com');
  assert.equal(normalizeHostname('WWW.YouTube.COM.'), 'youtube.com');
  assert.equal(normalizeHostname('en.wikipedia.org'), 'en.wikipedia.org');
  assert.equal(normalizeHostname('docs.google.com'), 'docs.google.com');
  assert.equal(hostnameOf('https://m.youtube.com/watch?v=1'), 'youtube.com');
});

test('categories: www/m variants, subdomain fallback, most specific match first', () => {
  assert.equal(getCategory('www.youtube.com'), 'entertainment');
  assert.equal(getCategory('m.youtube.com'), 'entertainment');
  assert.equal(getCategory('www.reddit.com'), 'entertainment');
  assert.equal(getCategory('en.wikipedia.org'), 'learning');      // falls back to wikipedia.org
  assert.equal(getCategory('de.m.wikipedia.org'), 'learning');
  assert.equal(getCategory('docs.google.com'), 'productive');      // full hostname match
  assert.equal(getCategory('news.google.com'), 'learning');
  assert.equal(getCategory('mail.google.com'), 'misc');            // no google.com entry
  assert.equal(getCategory('unknown.example'), 'misc');
  assert.equal(getCategory(''), 'misc');
});

test('user overrides take priority and apply everywhere', () => {
  const overrides = { 'youtube.com': 'learning', 'google.com': 'entertainment' };
  assert.equal(getCategory('www.youtube.com', overrides), 'learning');
  assert.equal(getCategory('m.youtube.com', overrides), 'learning');
  assert.equal(getCategory('music.youtube.com', overrides), 'learning');   // subdomain inherits
  // docs.google.com matches before google.com, so the built-in entry still wins there…
  assert.equal(getCategory('docs.google.com', overrides), 'productive');
  // …while an override on the exact host always wins.
  assert.equal(getCategory('docs.google.com', { 'docs.google.com': 'misc' }), 'misc');
  assert.equal(getCategory('mail.google.com', overrides), 'entertainment');
  // The score uses overrides too.
  const log = [{ domain: 'youtube.com', timeSpent: 600 }];
  assert.equal(calculateProductivityScore(log), 20);
  assert.equal(calculateProductivityScore(log, overrides), 100);
});

test('excluded domains match exactly or as subdomains, never as substrings', () => {
  assert.equal(isExcludedUrl('https://x.com/home', ['x.com']), true);
  assert.equal(isExcludedUrl('https://www.netflix.com/', ['x.com']), false);
  assert.equal(isExcludedUrl('https://mail.example.com/', ['example.com']), true);
  assert.equal(isExcludedUrl('https://notexample.com/', ['example.com']), false);
  assert.equal(isExcludedUrl('https://www.bank.com/', ['bank.com']), true);
  assert.equal(isExcludedUrl('http://localhost:3000/', ['localhost']), true);
  assert.equal(isExcludedUrl('chrome://settings', []), true, 'non-web pages are always excluded');
  assert.equal(isExcludedUrl('file:///Users/me/a.pdf', []), true);
  assert.equal(isExcludedUrl('https://intranet.corp/', ['https://intranet.corp/']), true, 'URL-prefix entries');
});
