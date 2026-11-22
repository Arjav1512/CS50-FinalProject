# VERIFICATION

All evidence below was produced in this session on 2026-11-22 (macOS, Node 22.20.0, Chrome for Testing 157 via Puppeteer 25.18.1).

- `npm test` → `# tests 74  # pass 74  # fail 0` (after the idle/audio change below; it was 70/70 before)
- `npm run test:e2e` → `43/43 e2e checks passed, 0 skipped` (final run, with the OS reporting an active user; earlier unattended runs: 41/41, 2 skipped)

Two e2e checks need the OS to report an active user (`chrome.idle`, 120 s threshold); on an unattended machine they print SKIP, never PASS. In the final run the user was active and both ran and passed: `tracking: first visit logged — logged 6s, real ≈6.1s` and `worker stopped mid-session: visit still logged within ±5s — logged 13s, real ≈13.2s (worker wake-up took ≈0.3s)`.

While getting that check to run, I found a harness artifact: Puppeteer's DevTools connection held the restarted worker paused ("waiting for debugger") for ~15 s, so the visit looked 15 s too long. The harness now resumes the worker immediately (`Runtime.runIfWaitingForDebugger`); with that, the worker started 5 ms after the tab activation. The extension code was not changed for this.

**Status key**
- **Verified:** a test or command in this session proves it.
- **Needs manual check:** needs a human, a real API key, or a real Notion database.
- **Not done:** not implemented.

"unit:" names a test in `npm test`. "e2e:" names a check line printed by `npm run test:e2e`.

## Independent review (Phase 7)

A separate reviewer agent was given only the original requirements and checked them against the code and its own runs of both test suites. It reported 9 problems. All were addressed, and each tracking bug now has a regression test that fails on the pre-fix code (verified by running the new tests against the previous commit's `lib/tracker.js`: 5 failures; with the fix: 0).

| # | Review finding | Resolution | Evidence |
|---|---|---|---|
| 1 | "Reset All Settings" reset retention to 90 days, so the next daily cleanup deleted older history | Reset keeps the retention period; texts updated | unit: Reset All Settings never causes old history to be deleted later |
| 2 | A tab activated while Chrome was in the background was timed | Sessions start only for the focused window's active tab; the minute flush re-checks this | unit: a tab activated while Chrome is in the background is not timed; the minute flush follows the active tab … |
| 3 | A site added to Excluded Domains kept being logged | Storage listener + flush re-check end it immediately | unit: adding the current site to Excluded Domains stops timing it immediately |
| 4 | ~10 MB storage cap; writes would fail silently | Documented in README "Known limitations" (with numbers); no new permission added | README |
| 5 | Options statistics counted unreadable legacy entries, reports did not | Statistics use the same readable entries as reports; README explains | `options.js` `renderStatistics` (uses `readableEntries`) |
| 6 | Small duplications (totals, per-day sums, today bounds, summary label, 3000 constant) | Moved into `lib/core.js`; page-text limit passed as an `executeScript` arg | `lib/core.js` (`totalSeconds`, `secondsByDay`, `dayBounds`, `summaryLabel`); `lib/summarize.js` |
| 7 | "Test Connection" is a third network trigger; README contradicted itself | README corrected; kept the button (it existed before and is an explicit click). **Flagged for owner decision** | README "Network requests" |
| 8 | "Clear All Data" keeps settings; static "Next milestone: 7 days"; dropdown stuck disabled on failure | Renamed "Clear Activity Data"; dynamic milestone; dropdown restored on failure | e2e: settings: Clear Activity Data …; `script.js` |
| 9 | Migration changes some stored data (end → start time, drops `category`, overrides 1.0 retention) | Documented in README "Upgrading from version 1.0". **Retention override flagged for owner decision** | unit: migration tests 27–34 |
| — | e2e worker network capture had no positive control | Added: a test-only request from inside the worker must be captured | e2e: positive control: a request made inside the worker IS captured |

## Requirements

### Decisions

| Requirement | Status | Evidence |
|---|---|---|
| Focus timer in the service worker with `chrome.alarms` (works with popup closed) | Verified | unit: focus session runs in the worker (alarm) …; a focus session still running after a browser restart gets its alarm back; e2e: goals: Start Focus Session creates a worker alarm … |
| Notification at the end (if enabled) with minutes on learning/productive sites from the log | Verified (logic) / Needs manual check (real OS notification) | unit: focus session runs in the worker … ("20 of 25 minutes …"); focus notification respects "Notify me …" |
| Goal-type dropdown removed | Verified | `ui.html` has only `#focusMinutes`; grep `goalType` finds nothing |
| PDF button renamed "Download report (.txt)", no PDF library | Verified | e2e: reports: "Download report (.txt)" downloads a .txt report …; `package.json` has only puppeteer (dev) |
| Custom date range implemented | Verified | unit: custom date range: inclusive whole days, validated; e2e: reports: Custom Range …, valid custom range renders that range |
| AI summaries off by default | Verified | unit: default settings: summarizing is refused, no page content is read and nothing is sent; e2e: summarize with default settings is refused and sends nothing |
| All-pages content script removed | Verified | unit: manifest: no content scripts …; `dataextraction.js` deleted |
| "Summarize this page" uses activeTab + chrome.scripting, current tab only, on click | Verified (logic) / Needs manual check (real activeTab grant) | unit: on click with summaries enabled: reads only that tab, sends one request …. The activeTab grant only exists when a human clicks the toolbar icon, which Puppeteer cannot do |
| One-line notice next to the button | Verified | `ui.html`: "Sends this page's text to Google Gemini."; screenshot `docs/screenshots/popup-home-scrolled.png` |
| Refuse on excluded domains | Verified | unit: excluded domains, incognito tabs and non-web pages are refused without reading them |
| API key on the options page | Verified | e2e: options: every field auto-saves (geminiApiKey); `options.html` `#geminiApiKey` |
| Model is one constant, current Flash model from ai.google.dev | Verified | `lib/gemini.js` `GEMINI_MODEL = 'gemini-3.8-flash'`; ai.google.dev/gemini-api/docs/models/gemini-3.8-flash fetched today: "Stable: gemini-3.8-flash", latest update September 2026; unit: Gemini request: current model constant … |
| Key in `x-goog-api-key` header, not URL | Verified | unit: Gemini request: … key in x-goog-api-key header, not in the URL |
| Notion: manual export only; auto-export and notionTemplate removed | Verified | grep `autoExport`/`notionTemplate` only in the migration's `REMOVED_KEYS`; no Notion alarm |
| Notion: read schema first, use the property of type "title"; Date/Productivity Score only if they exist | Verified (logic) / Needs manual check (real database) | unit: Notion: title property is whichever has type "title" …; Notion: Date and Productivity Score only set when they exist …; Notion export reads the schema first … |
| streakGoal wired | Verified | unit: streakGoal setting is respected …; e2e: options: every field auto-saves |
| enableNotifications wired (focus sessions) | Verified | unit: focus notification respects "Notify me when a focus session ends" … |
| dataRetention applied daily via `chrome.alarms` | Verified | unit: alarms are registered on worker start (retention period 1440); daily retention alarm removes old entries … |
| trackIncognito and enableGoalReminders removed | Verified | grep finds them only in `REMOVED_KEYS`; unit: migration removes dead settings … |
| Notion settings only on options page; popup Settings = theme, export/clear, link | Verified | `ui.html` Settings tab; e2e: settings: theme radio …, Export Data …, Open Full Settings …, Clear Activity Data … |
| Change a site's category from the popup; stored; applied everywhere | Verified | e2e: home: category select saves an override and updates the score (68 → 87); unit: user overrides take priority and apply everywhere; streakGoal … overrides; achievements use overrides; focus notification … overrides |
| System font stack | Verified | unit: HTML and CSS load nothing from the network …; `style.css` `font-family: system-ui, …` |
| No network requests unless the user clicks Summarize / Export to Notion | Verified (with one flagged exception) | e2e: positive control …; normal pages: zero network requests from the service worker; popup/options: zero network requests; popup controls / options page after use: zero network requests. Unit: network calls exist only in the Gemini and Notion code. Exception: options "Test Connection" also calls Notion on click (pre-existing; flagged) |

### Constraints

| Requirement | Status | Evidence |
|---|---|---|
| Plain JS, no bundler/framework/TS, Load unpacked with no build; ES modules | Verified | e2e loads the repository folder as-is (`enableExtensions: [ROOT]`): extension loads (service worker running) |
| Dev dependencies only for tests; real package.json | Verified | `package.json`: `devDependencies: { puppeteer }`, scripts `test`, `test:e2e` |
| Keep the current visual design | Needs manual check (judgement) | Same `style.css` variables/classes; screenshots in `docs/screenshots/` |
| schemaVersion + migration of `when` strings; never delete unparsed, log count | Verified | unit: migration converts en-US / en-GB / en-IN timestamps with zero entries lost; unparseable entries are kept unchanged, counted …; the service worker migrates 1.0 data on update and logs how many entries it kept |
| One shared module for categories, time formatting, summary text; no duplicated logic | Verified | `lib/core.js`; unit: report text and Notion summary text come from the shared module; scan of shipped JS for functions defined twice → none |
| No innerHTML with stored/fetched text | Verified | grep below (no matches); unit: no innerHTML …; e2e: home: AI summary shown as text (markup in it is not rendered) |
| Every permission and host permission used | Verified | unit: manifest: … no unused permissions |

### Phases

| Requirement | Status | Evidence |
|---|---|---|
| P0: PLAN.md; problems confirmed; branch; never commit to main | Verified | `PLAN.md`; `git log main` unchanged at `7bddbe5` |
| P0: gh/push possible | Verified | `gh auth status`: logged in as Arjav1512 (repo scope), viewerPermission ADMIN |
| P1: `node --test` + hand-written chrome mock (storage.local/session, alarms, idle, tabs, windows, runtime) | Verified | `test/helpers/chrome-mock.js`; unit: mock storage round-trips …; killing the worker drops listeners … |
| P1: pure logic in a module used by extension and tests | Verified | `lib/core.js` imported by `lib/tracker.js`, `script.js`, `options.js` and `test/unit/*` |
| P1: `npm run test:e2e` with Puppeteer and worker termination per Chrome's guide | Verified | e2e: service worker was actually stopped; service worker restarted on the next event |
| P2: active session in `chrome.storage.session` survives worker stop | Verified | unit: worker restart mid-session: logged duration within ±5 s …; worker restart without any alarm …; e2e: worker stopped mid-session: visit still logged within ±5s (13 s vs 13.2 s real) |
| P2: minute flush via `chrome.alarms` | Verified | unit: minute flush saves progress so a crash loses at most about a minute |
| P2: focus-change handler fixed | Verified | unit: window focus loss and regain …; a tab activated while Chrome is in the background is not timed |
| P2: chrome.idle (detection interval raised to 120 s by owner request): end on idle unless the tab is audible; always end on locked; start on active | Verified | unit: idle then active: idle time (including the 120 s detection window) is not counted; idle + audible tab keeps counting …; idle + tab not audible ends the session …; locked + audible still ends the session …; audio stops while idle: the next flush ends the session at the current time; screen locked ends the session immediately |
| P2: single write queue | Verified | unit: two sessions ending at the same moment are both saved (fails with the queue removed); simultaneous events … |
| P2: retention daily via alarms | Verified | unit: daily retention alarm … |
| P3: hostname normalization + full host before parent domains | Verified | unit: hostname normalization …; categories: www/m variants, subdomain fallback, most specific match first |
| P3: overrides beat the built-in map | Verified | unit: user overrides take priority and apply everywhere |
| P3: `Date.now()` timestamps; migration on install/update | Verified | unit: the service worker migrates 1.0 data on update …; tracker stores `when: startTime` |
| P3: streaks: consecutive days, streakGoal, counts to yesterday | Verified | unit: streak needs consecutive calendar days …; a gap day breaks the streak …; if today has not reached the goal yet … |
| P4: summary/key/fonts/permissions/web_accessible_resources decisions | Verified | see Decisions; unit: manifest: no content scripts, no web_accessible_resources … |
| P4: every fetch call listed in README | Verified | grep output below matches README "Network requests" (`lib/gemini.js`, `lib/notion.js` ×2) |
| P5: decisions for focus, report, custom range, Notion, settings | Verified (Notion with a real database and the real notification: Needs manual check) | see Decisions |
| P5: controls table; every control does what its label says | Verified | `docs/CONTROLS.md`; e2e controls checks (popup and options, 27 lines) |
| P6: "Digital Diary" everywhere; typos fixed | Verified | `git grep -i "daily digital diary\|digital digital"` → no matches outside PLAN.md history notes |
| P6: placeholder links | Verified | Real repository URL used (given by owner); e2e: options: About links point to the real repository |
| P6: icons 16/32/48/128 PNG | Verified | `file icons/*.png` → PNG RGBA at each size; used in manifest and notification |
| P6: README rewritten with required sections | Verified | `README.md` |
| P7: independent review; fixes; tests rerun | Verified | Section above; runs after the review: 70/70 and 41/41 (+2 skipped); final runs after the idle change: 74/74 and 43/43 (0 skipped) |

### Success metrics

| # | Metric | Status | Evidence |
|---|---|---|---|
| 1 | `npm test` passes, incl. all listed scenarios | Verified | 74/74 (70/70 before the idle/audio change). Restart ±5 s (52, 53), focus loss/regain (54), idle/active (55), simultaneous ends (57), normalization (1, 2), overrides (3), en-US/en-GB/en-IN migration (27–29), streak gap (46, 47), retention (70); numbers refer to the test list in this session's output |
| 2 | e2e: zero errors in worker and popup consoles; zero requests on a normal page with defaults; screenshots | Verified | e2e: service worker: zero errors; popup: zero console errors; positive control …; normal pages: zero network requests from the service worker; screenshots in `docs/screenshots/` |
| 3 | Default settings: no page content read, nothing sent | Verified | unit: default settings: summarizing is refused, no page content is read and nothing is sent; no content scripts; e2e network checks |
| 4 | No unused permissions; no `<all_urls>` content script | Verified | unit: manifest: …; manifest below |
| 5 | No innerHTML with stored/fetched data (grep proof) | Verified | grep below |
| 6 | Every control in the table and working; no dead settings | Verified | `docs/CONTROLS.md` + e2e controls checks; dead settings removed and migrated away |
| 7 | README matches behavior incl. full list of network requests | Verified | fetch grep below = README table; README updated after the review |

## Follow-up: audio-aware idle (owner request after the PR was opened)

Watching a video or listening to a podcast involves no input, so a 20-minute video was logged as about 1 minute.

| Requirement | Status | Evidence |
|---|---|---|
| On "idle", keep the session if the tracked tab is audible | Verified | unit: idle + audible tab keeps counting: a 20-minute video is logged as 20 minutes |
| "idle" with a silent tab ends the session (idle interval not counted) | Verified | unit: idle + tab not audible ends the session, without counting the idle interval |
| "locked" always ends the session, even with audio | Verified | unit: locked + audible still ends the session (event and flush) |
| flush(): idle and no longer audible → end at the current time | Verified | unit: audio stops while idle: the next flush ends the session at the current time |
| IDLE_DETECTION_SECONDS raised 60 → 120 | Verified | `lib/tracker.js`; unit: idle then active … (120 s detection window); `chrome.idle._detectionInterval === 120` |
| New tests detect the old behaviour | Verified | run against the previous commit's `lib/tracker.js`: 4 failures; with the change: 0 |
| Real video/podcast in real Chrome | Needs manual check | `tab.audible` comes from Chrome's audio indicator; the automated runs use a mock |

## Raw command output

```
$ grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document\.write" --include='*.js' --include='*.html' --exclude-dir=node_modules --exclude-dir=test .
innerHTML grep exit: 1          (no matches)

$ grep -rnE '\bfetch(Fn)?\(' --include='*.js' --exclude-dir=node_modules --exclude-dir=test .
lib/gemini.js:36:  const res = await fetchFn(url, init);
lib/notion.js:59:  const res = await fetchFn(`${NOTION_API}/databases/${id}`, { headers: headers(apiKey) });
lib/notion.js:73:  const res = await fetchFn(`${NOTION_API}/pages`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });

manifest.json permissions: tabs, storage, alarms, idle, notifications, activeTab, scripting
host_permissions: https://api.notion.com/*, https://generativelanguage.googleapis.com/*
(no content_scripts, no web_accessible_resources)
```

## Needs manual check (human)

1. Real tracking in your own browsing over 30+ minutes: alt-tab, 5 minutes away, and a 10+ minute video watched without touching the computer (it should count fully). The automated e2e covers short visits and a worker restart, not long sessions or real audio.
2. Real "Summarize this page" with a Gemini key (activeTab is only granted by a real click on the toolbar icon), and refusal on an excluded domain.
3. Real Notion export to a fresh database whose title column is "Name".
4. The real focus-session notification appearing after 5 minutes with the popup closed.
5. Updating an existing 1.0 install keeps its history.
6. Visual design judgement.
