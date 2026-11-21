// End-to-end checks: loads the unpacked extension (this repository folder) in
// Chrome for Testing via Puppeteer and verifies real browser behaviour.
//
//   npm run test:e2e            headless
//   HEADFUL=1 npm run test:e2e  visible browser
//
// Prints one PASS/FAIL line per check and exits non-zero if any check fails.
// Screenshots of the popup are written to docs/screenshots/.

import puppeteer from 'puppeteer';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

// ---------- local web server for "normal pages" ----------
function startServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><title>${req.headers.host}</title><article><h1>Test page on ${req.headers.host}</h1>` +
      `<p>${'Some article text to read. '.repeat(40)}</p></article>`);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- helpers ----------
// data:/blob: URLs (e.g. Chrome's built-in date-picker icon) never touch the network.
const isExtUrl = (url, id) => url.startsWith(`chrome-extension://${id}/`) || /^(data|blob):/.test(url);

async function attachWorker(browser, extensionId, sink) {
  const target = await browser.waitForTarget(
    t => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 15000 });
  const session = await target.createCDPSession();
  session.on('Runtime.exceptionThrown', e => sink.errors.push(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text));
  session.on('Runtime.consoleAPICalled', e => {
    if (e.type === 'error') sink.errors.push(e.args.map(a => a.value ?? a.description).join(' '));
  });
  session.on('Network.requestWillBeSent', e => sink.requests.push(e.request.url));
  await session.send('Runtime.enable');
  await session.send('Network.enable').catch(() => {});
  const worker = await target.worker();
  return { target, session, worker };
}

async function stopServiceWorker(browser, extensionId) {
  // From Chrome's "Test service worker termination with Puppeteer" guide.
  const host = `chrome-extension://${extensionId}`;
  const target = await browser.waitForTarget(t => t.type() === 'service_worker' && t.url().startsWith(host));
  const worker = await target.worker();
  await worker.close();
  // Wait until Chrome has really torn the old worker down.
  for (let i = 0; i < 50 && browser.targets().includes(target); i++) await sleep(100);
  return target;
}

async function openExtensionPage(browser, url, sink, viewport) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  page.on('console', m => { if (m.type() === 'error') sink.errors.push(`${url}: ${m.text()}`); });
  page.on('pageerror', e => sink.errors.push(`${url}: ${e.message}`));
  page.on('request', r => sink.requests.push(r.url()));
  await page.goto(url, { waitUntil: 'load' });
  await sleep(800);
  return page;
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const site = name => `http://${name}:${port}/article`;

  const stderrLines = [];
  const browser = await puppeteer.launch({
    headless: !process.env.HEADFUL,
    pipe: true,
    enableExtensions: [ROOT],
    args: [
      `--host-resolver-rules=MAP *.test 127.0.0.1`,
      '--enable-logging=stderr', '--v=0',
      '--no-first-run', '--no-default-browser-check'
    ]
  });
  browser.process()?.stderr?.on('data', d => stderrLines.push(...d.toString().split('\n')));

  let extensionId = null;
  const sw = { errors: [], requests: [] };
  try {
    // 1. Extension loads and its service worker starts.
    let worker;
    try {
      const target = await browser.waitForTarget(
        t => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'), { timeout: 15000 });
      extensionId = new URL(target.url()).host;
      ({ worker } = await attachWorker(browser, extensionId, sw));
      const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
      record('extension loads (service worker running)', true, `${manifest.name} ${manifest.version}, id ${extensionId}`);
    } catch (e) {
      record('extension loads (service worker running)', false, e.message);
      throw e;
    }

    // 2. Popup and options pages load with zero console errors and zero external requests.
    const popupSink = { errors: [], requests: [] };
    const popup = await openExtensionPage(browser, `chrome-extension://${extensionId}/ui.html`, popupSink, { width: 450, height: 600 });
    const optionsSink = { errors: [], requests: [] };
    const options = await openExtensionPage(browser, `chrome-extension://${extensionId}/options.html`, optionsSink);
    for (const [label, sink] of [['popup', popupSink], ['options page', optionsSink]]) {
      record(`${label}: zero console errors`, sink.errors.length === 0, sink.errors.slice(0, 3).join(' | '));
      const ext = sink.requests.filter(u => !isExtUrl(u, extensionId));
      record(`${label}: zero network requests`, ext.length === 0, ext.slice(0, 3).join(' | '));
    }
    await options.close();

    // 3. Visiting normal pages with default settings: zero requests from the extension,
    //    and the page only talks to its own server.
    const swBefore = sw.requests.length;
    const pageA = await browser.newPage();
    const pageRequests = [];
    pageA.on('request', r => pageRequests.push(r.url()));
    const tA0 = Date.now();
    await pageA.goto(site('www.youtube.test'), { waitUntil: 'load' });
    await pageA.bringToFront();
    await sleep(7000);
    const pageB = await browser.newPage();
    await pageB.goto(site('en.wikipedia.test'), { waitUntil: 'load' });
    await pageB.bringToFront();
    const elapsedA = (Date.now() - tA0) / 1000;
    await sleep(1500);
    const extReqs = sw.requests.slice(swBefore).filter(u => !isExtUrl(u, extensionId));
    record('normal pages: zero network requests from the service worker', extReqs.length === 0, extReqs.slice(0, 3).join(' | '));
    const foreign = pageRequests.filter(u => !u.startsWith(`http://www.youtube.test:${port}/`));
    record('normal pages: page makes no requests other than its own', foreign.length === 0, foreign.slice(0, 3).join(' | '));

    // 4. Tracking: the visit to page A was logged with about the right duration.
    const log1 = (await popup.evaluate(() => chrome.storage.local.get('activityLog'))).activityLog || [];
    const entryA = log1.find(e => e.domain === 'youtube.test' || e.domain === 'www.youtube.test');
    record('tracking: first visit logged', !!entryA && Math.abs(entryA.timeSpent - elapsedA) <= 5,
      entryA ? `logged ${entryA.timeSpent}s, real ≈${elapsedA.toFixed(1)}s, domain ${entryA.domain}` : `log: ${JSON.stringify(log1).slice(0, 200)}`);

    // 5. Service worker termination mid-session: the session survives.
    const pageC = await browser.newPage();
    await pageC.goto(site('docs.google.test'), { waitUntil: 'load' });
    await pageC.bringToFront();
    const tC0 = Date.now();
    await sleep(3000);
    const oldWorker = worker;
    await stopServiceWorker(browser, extensionId);
    const oldGone = await oldWorker.evaluate(() => 1).then(() => false, () => true);
    record('service worker was actually stopped', oldGone, 'old worker execution context is gone');
    await sleep(8000);
    // Opening a new tab fires tabs.onActivated, which wakes the stopped worker.
    const pageD = await browser.newPage();
    await pageD.goto(site('wake.test'), { waitUntil: 'load' });
    const elapsedC = (Date.now() - tC0) / 1000;
    await sleep(1500);
    const swTarget = browser.targets().find(t => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${extensionId}/`));
    record('service worker restarted on the next event', !!swTarget);
    if (swTarget) {
      const s2 = await swTarget.createCDPSession();
      s2.on('Runtime.exceptionThrown', e => sw.errors.push(e.exceptionDetails?.exception?.description || e.exceptionDetails?.text));
      s2.on('Runtime.consoleAPICalled', e => { if (e.type === 'error') sw.errors.push(e.args.map(a => a.value ?? a.description).join(' ')); });
      s2.on('Network.requestWillBeSent', e => sw.requests.push(e.request.url));
      await s2.send('Runtime.enable');
      await s2.send('Network.enable').catch(() => {});
    }
    const log2 = (await popup.evaluate(() => chrome.storage.local.get('activityLog'))).activityLog || [];
    const entryC = log2.find(e => e.domain === 'docs.google.test');
    record('worker stopped mid-session: visit still logged within ±5s', !!entryC && Math.abs(entryC.timeSpent - elapsedC) <= 5,
      entryC ? `logged ${entryC.timeSpent}s, real ≈${elapsedC.toFixed(1)}s` : 'no entry for docs.google.test');

    // 6. Service worker errors (CDP) and Chrome log lines mentioning the extension.
    const logErrors = stderrLines.filter(l => l.includes(extensionId) && /Uncaught|Error/i.test(l));
    record('service worker: zero errors', sw.errors.length === 0 && logErrors.length === 0,
      [...sw.errors, ...logErrors].slice(0, 3).join(' | '));

    // 7. Popup screenshots (after some activity exists).
    fs.mkdirSync(SHOTS, { recursive: true });
    const shotSink = { errors: [], requests: [] };
    const shotPage = await openExtensionPage(browser, `chrome-extension://${extensionId}/ui.html`, shotSink, { width: 450, height: 600 });
    for (const tab of ['home', 'reports', 'goals', 'settings']) {
      await shotPage.click(`.nav-tab[data-tab="${tab}"]`);
      await sleep(400);
      await shotPage.screenshot({ path: path.join(SHOTS, `popup-${tab}.png`) });
    }
    record('popup screenshots saved', true, path.relative(ROOT, SHOTS));
    record('popup with data: zero console errors while switching tabs', shotSink.errors.length === 0, shotSink.errors.slice(0, 3).join(' | '));
    const late = shotSink.requests.filter(u => !isExtUrl(u, extensionId));
    record('popup with data: zero network requests', late.length === 0, late.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('targets at failure:', browser.targets().map(t => `${t.type()} ${t.url().slice(0, 70)}`));
    record('e2e run completed', false, e.stack?.split('\n').slice(0, 2).join(' '));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
