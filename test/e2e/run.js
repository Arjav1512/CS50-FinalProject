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
const skipped = [];
function skip(name, reason) {
  skipped.push({ name, reason });
  console.log(`SKIP  ${name}  — ${reason}`);
}

// chrome.idle reports the operating system's input idleness. On an unattended
// machine (no keyboard/mouse input for 60 s) Chrome correctly reports "idle" and
// the extension correctly stops counting time, so tracking checks cannot run.
// They are reported as SKIP (never as PASS) in that case.
const IDLE_REASON = 'the OS reports no user input for 60 s (chrome.idle = idle), so the extension correctly does not track; rerun while using the computer';
const idleState = page => page.evaluate(() => chrome.idle.queryState(60));

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

// Activates the tab showing `url` through the real chrome.tabs API (called from
// an extension page). This fires a genuine tabs.onActivated event, like a user
// clicking the tab. Headless Chrome's bringToFront() does not reliably do that.
async function activateTab(extPage, url) {
  return extPage.evaluate(async u => {
    const tabs = await chrome.tabs.query({});
    const tab = tabs.find(t => t.url === u || t.pendingUrl === u);
    if (!tab) throw new Error(`no tab for ${u}`);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id;
  }, url);
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

    // An extension page used to call chrome.* APIs from the test.
    const popupSink = { errors: [], requests: [] };
    const popup = await openExtensionPage(browser, `chrome-extension://${extensionId}/ui.html`, popupSink, { width: 450, height: 600 });

    // Tracking checks run first: chrome.idle needs recent user input (see IDLE_REASON).
    // 3. Visiting normal pages with default settings: zero requests from the extension,
    //    and the page only talks to its own server.
    // Record every OS idle transition during the run (diagnostics + honest SKIP).
    await popup.evaluate(() => {
      window.__idleEvents = [];
      chrome.idle.onStateChanged.addListener(state => window.__idleEvents.push([Date.now(), state]));
    });
    const idleEventsBetween = (from, to) => popup.evaluate((a, b) => window.__idleEvents.filter(([t]) => t >= a && t <= b), from, to);
    const idleAtStart = await idleState(popup);
    console.log(`info  OS idle state at start of tracking checks: ${idleAtStart}`);
    const swBefore = sw.requests.length;
    const pageA = await browser.newPage();
    const pageRequests = [];
    pageA.on('request', r => pageRequests.push(r.url()));
    const tA0 = Date.now();
    await pageA.goto(site('www.youtube.test'), { waitUntil: 'load' });
    await activateTab(popup, site('www.youtube.test'));
    await sleep(6000);
    const pageB = await browser.newPage();
    await pageB.goto(site('en.wikipedia.test'), { waitUntil: 'load' });
    await activateTab(popup, site('en.wikipedia.test'));
    const elapsedA = (Date.now() - tA0) / 1000;
    await sleep(1500);
    const extReqs = sw.requests.slice(swBefore).filter(u => !isExtUrl(u, extensionId));
    record('normal pages: zero network requests from the service worker', extReqs.length === 0, extReqs.slice(0, 3).join(' | '));
    const foreign = pageRequests.filter(u => !u.startsWith(`http://www.youtube.test:${port}/`));
    record('normal pages: page makes no requests other than its own', foreign.length === 0, foreign.slice(0, 3).join(' | '));

    // 4. Tracking: the visit to page A was logged with about the right duration.
    const log1 = (await popup.evaluate(() => chrome.storage.local.get('activityLog'))).activityLog || [];
    const entryA = log1.find(e => e.domain === 'youtube.test' || e.domain === 'www.youtube.test');
    const idleA = await idleState(popup);
    const idleDuringA = await idleEventsBetween(tA0 - 1000, Date.now());
    if (idleAtStart !== 'active' || idleA !== 'active' || idleDuringA.length) {
      skip('tracking: first visit logged', `${IDLE_REASON} (idle state: ${idleAtStart} → ${idleA}; transitions: ${JSON.stringify(idleDuringA.map(e => e[1]))})`);
    } else {
      record('tracking: first visit logged', !!entryA && Math.abs(entryA.timeSpent - elapsedA) <= 5,
        entryA ? `logged ${entryA.timeSpent}s, real ≈${elapsedA.toFixed(1)}s, domain ${entryA.domain}` : `log: ${JSON.stringify(log1).slice(0, 200)}`);
    }

    // 5. Service worker termination mid-session: the session survives.
    const idleBeforeC = await idleState(popup);
    const pageC = await browser.newPage();
    await pageC.goto(site('docs.google.test'), { waitUntil: 'load' });
    await activateTab(popup, site('docs.google.test'));
    const tC0 = Date.now();
    await sleep(3000);
    const oldWorker = worker;
    await stopServiceWorker(browser, extensionId);
    const oldGone = await oldWorker.evaluate(() => 1).then(() => false, () => true);
    record('service worker was actually stopped', oldGone, 'old worker execution context is gone');
    await sleep(5000);
    // Activating another tab fires tabs.onActivated, which wakes the stopped worker.
    const pageD = await browser.newPage();
    await pageD.goto(site('wake.test'), { waitUntil: 'load' });
    await activateTab(popup, site('wake.test'));
    const elapsedC = (Date.now() - tC0) / 1000;   // real time spent on the docs page
    // Wait for the restarted worker to process the activation.
    let entryC = null;
    const tWake = Date.now();
    for (let i = 0; i < 60 && !entryC; i++) {
      const log = (await popup.evaluate(() => chrome.storage.local.get('activityLog'))).activityLog || [];
      entryC = log.find(e => e.domain === 'docs.google.test');
      if (!entryC) await sleep(250);
    }
    const wakeLatency = (Date.now() - tWake) / 1000;
    const lastSeenLog = (await popup.evaluate(() => chrome.storage.local.get(null)));
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
    const idleAfterC = await idleState(popup);
    const idleDuringC = await idleEventsBetween(tC0 - 1000, Date.now());
    if (idleBeforeC !== 'active' || idleAfterC !== 'active' || idleDuringC.length) {
      skip('worker stopped mid-session: visit still logged within ±5s', `${IDLE_REASON} (idle state: ${idleBeforeC} → ${idleAfterC}; transitions during check: ${JSON.stringify(idleDuringC.map(([t, st]) => `${((t - tC0) / 1000).toFixed(1)}s:${st}`))})`);
    } else record('worker stopped mid-session: visit still logged within ±5s', !!entryC && Math.abs(entryC.timeSpent - elapsedC) <= 5,
      entryC ? `logged ${entryC.timeSpent}s, real ≈${elapsedC.toFixed(1)}s (worker wake-up took ≈${wakeLatency.toFixed(1)}s)` : `no entry for docs.google.test; storage: ${JSON.stringify(lastSeenLog).slice(0, 400)}`);

    // 6a. Popup and options pages load with zero console errors and zero external requests.
    const optionsSink = { errors: [], requests: [] };
    const options = await openExtensionPage(browser, `chrome-extension://${extensionId}/options.html`, optionsSink);
    for (const [label, sink] of [['popup', popupSink], ['options page', optionsSink]]) {
      record(`${label}: zero console errors`, sink.errors.length === 0, sink.errors.slice(0, 3).join(' | '));
      const ext = sink.requests.filter(u => !isExtUrl(u, extensionId));
      record(`${label}: zero network requests`, ext.length === 0, ext.slice(0, 3).join(' | '));
    }
    await options.close();

    // 6b. "Summarize this page" with default settings: refused, nothing read or sent.
    const swReqBefore = sw.requests.length;
    const popupReqBefore = popupSink.requests.length;
    await popup.bringToFront();
    await popup.click('#summarizeBtn');
    await popup.waitForFunction(() => !document.querySelector('#summarizeBtn').disabled, { timeout: 10000 });
    const summarizeMsg = await popup.$eval('#summaryResult', el => el.textContent.trim());
    const newReqs = [...sw.requests.slice(swReqBefore), ...popupSink.requests.slice(popupReqBefore)].filter(u => !isExtUrl(u, extensionId));
    record('summarize with default settings is refused and sends nothing',
      /turned off/i.test(summarizeMsg) && newReqs.length === 0, `message: "${summarizeMsg}"; requests: ${newReqs.length}`);

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
  console.log(`\n${results.length - failed.length}/${results.length} e2e checks passed, ${skipped.length} skipped`);
  for (const k of skipped) console.log(`  skipped: ${k.name}`);
  process.exit(failed.length ? 1 : 0);
}

main();
