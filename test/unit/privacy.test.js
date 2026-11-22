import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChromeMock } from '../helpers/chrome-mock.js';
import { createTracker } from '../../lib/tracker.js';
import { summarizePage } from '../../lib/summarize.js';
import { buildSummaryRequest, parseSummaryResponse, GEMINI_MODEL, GEMINI_ENDPOINT, MAX_PAGE_CHARS } from '../../lib/gemini.js';
import { extractPageText } from '../../lib/page-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Every file that ships in the extension (everything except tests/tooling).
function extensionSourceFiles() {
  const out = [];
  const walk = dir => {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      const rel = path.join(dir, name);
      if (['node_modules', 'test', '.git', 'docs', 'scripts'].includes(rel.split(path.sep)[0])) continue;
      const stat = fs.statSync(path.join(ROOT, rel));
      if (stat.isDirectory()) walk(rel);
      else if (/\.(js|html|css)$/.test(name)) out.push(rel);
    }
  };
  walk('.');
  return out.map(f => f.replace(/^\.\//, ''));
}

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: response.ok ?? true, status: response.status ?? 200, json: async () => response.json };
  };
  fn.calls = calls;
  return fn;
}

const ARTICLE = 'Lorem ipsum dolor sit amet. '.repeat(30);

function browserWithTab(url, extra = {}) {
  const chrome = createChromeMock();
  chrome._addTab({ id: 7, url, active: true, ...extra });
  chrome.scripting._result = { title: 'A page', text: ARTICLE };
  return chrome;
}

test('Gemini request: current model constant, key in x-goog-api-key header, not in the URL', () => {
  assert.equal(GEMINI_MODEL, 'gemini-3.8-flash');
  const { url, init } = buildSummaryRequest('SECRET-KEY', 'x'.repeat(10000), 'Title');
  assert.equal(url, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  assert.equal(url.includes('SECRET-KEY'), false);
  assert.equal(url.includes('key='), false);
  assert.equal(init.headers['x-goog-api-key'], 'SECRET-KEY');
  const prompt = JSON.parse(init.body).contents[0].parts[0].text;
  assert.ok(prompt.length < MAX_PAGE_CHARS + 300, 'page text is truncated');
});

test('Gemini responses: text extracted, API errors surfaced (no "No summary available." placeholder)', () => {
  assert.equal(parseSummaryResponse(true, 200, { candidates: [{ content: { parts: [{ text: ' • point ' }] } }] }), '• point');
  assert.throws(() => parseSummaryResponse(false, 404, { error: { message: 'models/gemini-pro is not found' } }), /not found/);
  assert.throws(() => parseSummaryResponse(true, 200, { candidates: [] }), /no summary/);
});

test('default settings: summarizing is refused, no page content is read and nothing is sent', async () => {
  const chrome = browserWithTab('https://example.com/article');
  const fetch = fakeFetch({ json: {} });
  const result = await summarizePage(chrome, createTracker(chrome), 7, fetch);
  assert.equal(result.ok, false);
  assert.match(result.error, /turned off/);
  assert.equal(chrome.scripting._calls.length, 0, 'page not read');
  assert.equal(fetch.calls.length, 0, 'nothing sent');
});

test('enabled but no API key: refused before reading the page', async () => {
  const chrome = browserWithTab('https://example.com/article');
  await chrome.storage.local.set({ enableSummaries: true });
  const fetch = fakeFetch({ json: {} });
  const result = await summarizePage(chrome, createTracker(chrome), 7, fetch);
  assert.match(result.error, /API key/);
  assert.equal(chrome.scripting._calls.length + fetch.calls.length, 0);
});

test('excluded domains, incognito tabs and non-web pages are refused without reading them', async () => {
  for (const [url, extra, pattern] of [
    ['https://mail.mybank.com/statement', {}, /excluded/],
    ['https://example.com/', { incognito: true }, /Incognito/],
    ['chrome://settings/', {}, /web pages/],
    ['file:///Users/me/secret.txt', {}, /web pages/]
  ]) {
    const chrome = browserWithTab(url, extra);
    await chrome.storage.local.set({ enableSummaries: true, geminiApiKey: 'k', excludedDomains: ['mybank.com'] });
    const fetch = fakeFetch({ json: {} });
    const result = await summarizePage(chrome, createTracker(chrome), 7, fetch);
    assert.match(result.error, pattern, url);
    assert.equal(chrome.scripting._calls.length + fetch.calls.length, 0, url);
  }
});

test('on click with summaries enabled: reads only that tab, sends one request, stores the summary', async () => {
  const chrome = browserWithTab('https://example.com/article');
  await chrome.storage.local.set({ enableSummaries: true, geminiApiKey: 'k' });
  const fetch = fakeFetch({ json: { candidates: [{ content: { parts: [{ text: '• Key point' }] } }] } });
  const result = await summarizePage(chrome, createTracker(chrome), 7, fetch);
  assert.equal(result.ok, true);
  assert.equal(result.summary, '• Key point');
  assert.equal(chrome.scripting._calls.length, 1);
  assert.deepEqual(chrome.scripting._calls[0].target, { tabId: 7 });
  assert.equal(chrome.scripting._calls[0].func, extractPageText);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, GEMINI_ENDPOINT);
  const { summaries } = await chrome.storage.local.get('summaries');
  assert.equal(summaries.length, 1);
  assert.equal(typeof summaries[0].time, 'number');
});

test('worker ignores messages that do not come from the extension\'s own pages', async () => {
  const chrome = browserWithTab('https://example.com/article');
  globalThis.chrome = chrome;
  await import('../../trackingtabs.js?privacy-test');
  const own = await chrome.runtime.sendMessage({ type: 'summarizePage', tabId: 7 });
  assert.equal(own.ok, false);
  assert.match(own.error, /turned off/);
  const foreign = await chrome.runtime.sendMessage({ type: 'summarizePage', tabId: 7 }, { id: chrome.runtime.id, url: 'https://evil.example/' });
  assert.equal(foreign, undefined, 'no response for a web page sender');
});

test('manifest: no content scripts, no web_accessible_resources, no unused permissions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false);
  const code = extensionSourceFiles().filter(f => f.endsWith('.js')).map(read).join('\n');
  for (const permission of manifest.permissions) {
    if (permission === 'activeTab') {
      // activeTab has no API of its own: it is what lets chrome.scripting read the
      // tab the user opened the popup on, without host permissions for all sites.
      assert.ok(manifest.permissions.includes('scripting') && /chrome\.scripting\.executeScript/.test(code));
      continue;
    }
    assert.ok(code.includes(`chrome.${permission}.`), `permission "${permission}" is used`);
  }
  for (const host of manifest.host_permissions) {
    const origin = host.replace('/*', '');
    assert.ok(code.includes(origin), `host permission ${host} is used`);
  }
  for (const banned of ['identity', 'history']) assert.equal(manifest.permissions.includes(banned), false);
});

test('no innerHTML / outerHTML / insertAdjacentHTML / document.write anywhere in the extension', () => {
  for (const file of extensionSourceFiles()) {
    const src = read(file);
    assert.equal(/\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write\(/.test(src), false, file);
  }
});

test('network calls exist only in the Gemini and Notion code', () => {
  const withFetch = extensionSourceFiles().filter(f => /\bfetch(Fn)?\(/.test(read(f))).sort();
  // script.js / options.js only pass `fetch` into the Notion helpers.
  assert.deepEqual(withFetch, ['lib/gemini.js', 'lib/notion.js']);
});

test('HTML and CSS load nothing from the network (no web fonts, CDNs or remote scripts)', () => {
  for (const file of extensionSourceFiles().filter(f => /\.(html|css)$/.test(f))) {
    const src = read(file);
    assert.equal(/<(link|script|img)[^>]+(href|src)=["']https?:/i.test(src), false, file);
    assert.equal(/@import\s+url\(["']?https?:|url\(["']?https?:/i.test(src), false, file);
  }
});
