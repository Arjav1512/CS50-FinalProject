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
import os from 'node:os';
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
      // Positive control: prove the worker's network capture works before
      // trusting "zero requests". This test-only request is made via DevTools.
      const probe = `http://probe.test:${port}/probe`;
      await worker.evaluate(u => fetch(u, { mode: 'no-cors' }).then(() => true, () => false), probe);
      await sleep(300);
      const seen = sw.requests.includes(probe);
      record('positive control: a request made inside the worker IS captured', seen);
      sw.requests = sw.requests.filter(u => u !== probe);
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

    // 7. Seed realistic data through the extension's own storage API so the
    //    popup has something to show (independent of OS idle state).
    await popup.evaluate(async () => {
      const now = Date.now();
      const day = 86400000;
      const start = new Date(); start.setHours(9, 0, 0, 0);
      const t = start.getTime();
      const mk = (id, domain, when, timeSpent) => ({ id, domain, url: `https://${domain}/`, when, timeSpent });
      const activityLog = [
        mk('s1', 'en.wikipedia.org', t, 2400), mk('s2', 'youtube.com', t + 2500000, 1500),
        mk('s3', 'github.com', t + 4100000, 1800), mk('s4', 'reddit.com', t + 6000000, 600),
        mk('s5', 'docs.google.com', t - day, 2400), mk('s6', 'wikipedia.org', t - 2 * day, 2000),
        mk('old', 'example.com', now - 400 * day, 60)
      ];
      await chrome.storage.local.set({
        activityLog,
        summaries: [{ url: 'https://en.wikipedia.org/wiki/Habit', title: 'Habit - Wikipedia', summary: '• Habits form through repetition.\n• Cues trigger routines. <b>not bold</b>', time: t + 1000 }],
        geminiApiKey: 'SECRET-GEMINI', notionApiKey: 'SECRET-NOTION'
      });
    });

    // 8. Popup screenshots.
    fs.mkdirSync(SHOTS, { recursive: true });
    const shotSink = { errors: [], requests: [] };
    const shotPage = await openExtensionPage(browser, `chrome-extension://${extensionId}/ui.html`, shotSink, { width: 450, height: 600 });
    for (const tab of ['home', 'reports', 'goals', 'settings']) {
      await shotPage.click(`.nav-tab[data-tab="${tab}"]`);
      await sleep(400);
      const active = await shotPage.$eval('.tab-pane.active', el => el.id);
      if (active !== tab) record(`nav tab "${tab}" shows its pane`, false, `active pane: ${active}`);
      await shotPage.screenshot({ path: path.join(SHOTS, `popup-${tab}.png`) });
      if (tab === 'home' || tab === 'reports') {
        await shotPage.evaluate(() => { document.querySelector('.tab-content').scrollTop = 420; });
        await sleep(200);
        await shotPage.screenshot({ path: path.join(SHOTS, `popup-${tab}-scrolled.png`) });
        await shotPage.evaluate(() => { document.querySelector('.tab-content').scrollTop = 0; });
      }
    }
    record('popup screenshots saved (4 nav tabs each show their pane)', true, path.relative(ROOT, SHOTS));

    // 9. Every popup control.
    const p = shotPage;
    const dialogs = [];
    let dialogAction = 'accept';
    p.on('dialog', async d => { dialogs.push(d.message()); await (dialogAction === 'accept' ? d.accept() : d.dismiss()); });
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-e2e-'));
    const cdp = await browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
    const waitForDownload = async (re) => {
      for (let i = 0; i < 40; i++) {
        const f = fs.readdirSync(downloadDir).find(n => re.test(n) && !n.endsWith('.crdownload'));
        if (f) return path.join(downloadDir, f);
        await sleep(250);
      }
      return null;
    };
    const store = keys => p.evaluate(k => chrome.storage.local.get(k), keys);

    await p.click('.nav-tab[data-tab="home"]'); await sleep(300);
    const summaryHtml = await p.$eval('#todayReport', el => ({ text: el.textContent, bold: el.querySelectorAll('b').length }));
    record('home: AI summary shown as text (markup in it is not rendered)', summaryHtml.text.includes('<b>not bold</b>') && summaryHtml.bold === 0);
    const scoreBefore = await p.$eval('#productivityScore', el => el.textContent);
    await p.select('select[aria-label="Category for youtube.com"]', 'learning');
    await sleep(800);
    const ov = await store('categoryOverrides');
    const scoreAfter = await p.$eval('#productivityScore', el => el.textContent);
    record('home: category select saves an override and updates the score',
      ov.categoryOverrides?.['youtube.com'] === 'learning' && scoreAfter !== scoreBefore, `score ${scoreBefore} → ${scoreAfter}`);

    const themeBefore = (await store('theme')).theme || 'dark';
    await p.click('#themeToggle'); await sleep(300);
    const themeAfter = (await store('theme')).theme;
    const attr = await p.evaluate(() => document.documentElement.getAttribute('data-theme'));
    record('header: theme toggle switches and saves the theme', themeAfter !== themeBefore && attr === themeAfter, `${themeBefore} → ${themeAfter}`);
    await p.click('#themeToggle'); await sleep(200);

    dialogAction = 'dismiss';
    await p.evaluate(() => chrome.storage.local.remove(['notionApiKey']));
    await sleep(300);
    const reqBeforeNotion = shotSink.requests.length;
    await p.click('#exportNotionBtn'); await sleep(400);
    record('home: Export to Notion without settings asks to open settings and sends nothing',
      /Notion is not set up/.test(dialogs.at(-1) || '') && shotSink.requests.slice(reqBeforeNotion).filter(u => !isExtUrl(u, extensionId)).length === 0, dialogs.at(-1));
    await p.evaluate(() => chrome.storage.local.set({ notionApiKey: 'SECRET-NOTION' }));
    dialogAction = 'accept';

    await p.click('#startGoalBtn'); await sleep(300);
    const focusTab = await p.evaluate(() => ({ pane: document.querySelector('.tab-pane.active').id, focused: document.activeElement.id }));
    record('home: Focus Session button opens the focus panel', focusTab.pane === 'goals' && focusTab.focused === 'focusMinutes', JSON.stringify(focusTab));

    // Focus: invalid, start, stop
    await p.$eval('#focusMinutes', el => { el.value = '2'; });
    await p.click('#startFocusBtn'); await sleep(500);
    record('goals: focus session shorter than 5 min is refused', /between 5 and 480/.test(dialogs.at(-1) || ''), dialogs.at(-1));
    await p.$eval('#focusMinutes', el => { el.value = '5'; });
    await p.click('#startFocusBtn'); await sleep(800);
    const alarm = await p.evaluate(() => chrome.alarms.get('focusEnd'));
    const focusText = await p.$eval('#focusDisplay', el => el.textContent);
    record('goals: Start Focus Session creates a worker alarm (survives closing the popup) and shows a countdown',
      !!alarm && Math.abs(alarm.scheduledTime - Date.now() - 300000) < 10000 && /remaining/.test(focusText), focusText.trim().slice(0, 60));
    await p.click('#stopFocusBtn'); await sleep(800);
    const afterStop = await p.evaluate(async () => ({ alarm: await chrome.alarms.get('focusEnd'), f: (await chrome.storage.local.get('focusSession')).focusSession }));
    record('goals: Stop Session clears the alarm', !afterStop.alarm && afterStop.f?.stopped === true);

    // Reports
    await p.click('.nav-tab[data-tab="reports"]'); await sleep(300);
    await p.select('#dateRange', 'custom'); await sleep(200);
    const customVisible = await p.$eval('#customDateRange', el => !el.classList.contains('hidden'));
    await p.$eval('#startDate', el => { el.value = '2030-01-10'; el.dispatchEvent(new Event('change')); });
    await p.$eval('#endDate', el => { el.value = '2030-01-01'; el.dispatchEvent(new Event('change')); });
    await sleep(200);
    const invalid = await p.evaluate(() => ({ err: document.querySelector('#rangeError').textContent, disabled: document.querySelector('#downloadReportBtn').disabled }));
    record('reports: Custom Range shows date pickers and rejects start after end', customVisible && /on or before/.test(invalid.err) && invalid.disabled, invalid.err);
    const todayKey = await p.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    const twoDaysAgo = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
    await p.$eval('#startDate', (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, twoDaysAgo);
    await p.$eval('#endDate', (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); }, todayKey);
    await sleep(300);
    const reportText = await p.$eval('#reportContent', el => el.textContent);
    record('reports: valid custom range renders that range', /Custom Range Summary/.test(reportText) && /Days Active: 3/.test(reportText), reportText.slice(0, 80));
    await p.click('#downloadReportBtn');
    const reportFile = await waitForDownload(/^digital-diary-report-custom-.*\.txt$/);
    const reportBody = reportFile ? fs.readFileSync(reportFile, 'utf8') : '';
    record('reports: "Download report (.txt)" downloads a .txt report for the selected range (local date in name)',
      !!reportFile && /DIGITAL DIARY REPORT/.test(reportBody) && /Period: Custom Range/.test(reportBody) && path.basename(reportFile).includes(todayKey),
      reportFile ? path.basename(reportFile) : 'no file');
    await p.evaluate(() => chrome.storage.local.get('activityLog').then(({ activityLog }) =>
      chrome.storage.local.set({ activityLog: [...activityLog, { id: 'r1', domain: 'coursera.org', url: 'https://coursera.org/', when: Date.now() - 3600000, timeSpent: 900 }] })));
    await p.click('#refreshReportBtn'); await sleep(500);
    record('reports: Refresh Data re-reads storage', /coursera|learning/.test(await p.$eval('#reportContent', el => el.textContent)));

    // Settings tab
    await p.click('.nav-tab[data-tab="settings"]'); await sleep(300);
    await p.click('input[name="theme"][value="auto"]'); await sleep(300);
    record('settings: theme radio "Auto (System)" is saved as auto', (await store('theme')).theme === 'auto');
    await p.click('#exportDataBtn');
    const exportFile = await waitForDownload(/^digital-diary-export-.*\.json$/);
    const exported = exportFile ? JSON.parse(fs.readFileSync(exportFile, 'utf8')) : {};
    record('settings: Export Data (JSON) downloads data without API keys',
      !!exportFile && Array.isArray(exported.activityLog) && !('geminiApiKey' in exported) && !('notionApiKey' in exported));
    const optionsOpened = browser.waitForTarget(t => t.url() === `chrome-extension://${extensionId}/options.html`, { timeout: 5000 }).then(() => true, () => false);
    await p.click('#openOptionsBtn');
    record('settings: Open Full Settings opens the options page', await optionsOpened);
    await p.bringToFront(); // dialogs in a background tab would stall
    dialogAction = 'accept';
    await p.click('#clearDataBtn'); await sleep(800);
    const afterClear = await store(null);
    record('settings: Clear Activity Data deletes activity/summaries/overrides and keeps settings',
      /permanently deletes/.test(dialogs.at(-1) || '') && !afterClear.activityLog && !afterClear.summaries && !afterClear.categoryOverrides && afterClear.theme === 'auto' && afterClear.geminiApiKey === 'SECRET-GEMINI');
    record('popup controls: zero console errors', shotSink.errors.length === 0, shotSink.errors.slice(0, 3).join(' | '));
    const late = shotSink.requests.filter(u => !isExtUrl(u, extensionId));
    record('popup controls: zero network requests', late.length === 0, late.slice(0, 3).join(' | '));

    // 10. Every options-page control.
    const oSink = { errors: [], requests: [] };
    const o = await openExtensionPage(browser, `chrome-extension://${extensionId}/options.html`, oSink);
    o.on('dialog', d => d.accept());
    const setField = async (sel, value) => {
      await o.$eval(sel, (el, v) => {
        if (el.type === 'checkbox') el.checked = v; else el.value = v;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    };
    await setField('#notionApiKey', 'ntn_test');
    await setField('#notionDatabaseId', 'https://www.notion.so/x/0123456789abcdef0123456789abcdef');
    await setField('#enableSummaries', true);
    await setField('#geminiApiKey', 'gem-key');
    await setField('#minTrackingTime', '999');
    await setField('#excludedDomains', 'localhost\nmybank.com');
    await setField('#streakGoal', '45');
    await setField('#enableNotifications', false);
    await setField('#dataRetention', '30');
    await sleep(900);
    const saved = await o.evaluate(() => chrome.storage.local.get(null));
    const expectSaved = { notionApiKey: 'ntn_test', enableSummaries: true, geminiApiKey: 'gem-key', minTrackingTime: 60, streakGoal: 45, enableNotifications: false, dataRetention: 30 };
    const mismatched = Object.entries(expectSaved).filter(([k, v]) => saved[k] !== v).map(([k]) => `${k}=${saved[k]}`);
    record('options: every field auto-saves (with clamping)',
      mismatched.length === 0 && saved.excludedDomains.join(',') === 'localhost,mybank.com' && saved.notionDatabaseId.includes('0123456789abcdef'),
      mismatched.join(', ') || 'all saved');
    await setField('#notionApiKey', '');
    await o.click('#testNotionConnection'); await sleep(300);
    record('options: Test Connection validates input locally (no request without a key)',
      /Enter your Notion API key/.test(await o.$eval('#notionStatus', el => el.textContent)) && oSink.requests.filter(u => !isExtUrl(u, extensionId)).length === 0);
    await o.$eval('#notionApiKey', el => { el.value = 'ntn_saved'; });
    await o.click('#saveNotionSettings'); await sleep(300);
    record('options: Save Settings (Notion) stores the key', (await o.evaluate(() => chrome.storage.local.get('notionApiKey'))).notionApiKey === 'ntn_saved');
    await o.evaluate(() => chrome.storage.local.set({ activityLog: [
      { id: 'o', domain: 'a.com', url: 'https://a.com', when: Date.now() - 40 * 86400000, timeSpent: 5 },
      { id: 'n', domain: 'a.com', url: 'https://a.com', when: Date.now(), timeSpent: 5 }] }));
    await o.click('#clearOldData'); await sleep(800);
    const oldMsg = await o.$eval('#dataStatus', el => el.textContent);
    const remaining = (await o.evaluate(() => chrome.storage.local.get('activityLog'))).activityLog.map(e => e.id);
    record('options: Clear Old Data Now deletes entries older than the retention period', /Deleted 1 visits/.test(oldMsg) && remaining.join() === 'n', oldMsg);
    await o.click('#exportAllData');
    const optExport = await waitForDownload(/^digital-diary-export-.*\.json$/);
    record('options: Export Data (JSON) works', !!optExport);
    await o.click('#resetSettings'); await sleep(800);
    const afterReset = await o.evaluate(() => chrome.storage.local.get(null));
    record('options: Reset All Settings restores defaults and keeps activity',
      afterReset.streakGoal === undefined && afterReset.geminiApiKey === undefined && afterReset.activityLog?.length === 1 &&
      (await o.$eval('#streakGoal', el => el.value)) === '30');
    const links = await o.evaluate(() => [document.querySelector('#viewSource').href, document.querySelector('#reportIssue').href]);
    record('options: About links point to the real repository', links[0] === 'https://github.com/Arjav1512/CS50-FinalProject' && links[1].endsWith('/issues'), links.join(' '));
    const stats = await o.$eval('#totalSites', el => el.textContent);
    record('options: statistics are shown', stats === '1', `sites: ${stats}`);
    await o.screenshot({ path: path.join(SHOTS, 'options.png'), fullPage: true });
    record('options page: zero console errors after use', oSink.errors.length === 0, oSink.errors.slice(0, 3).join(' | '));
    record('options page: zero network requests after use', oSink.requests.filter(u => !isExtUrl(u, extensionId)).length === 0);
    fs.rmSync(downloadDir, { recursive: true, force: true });
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
