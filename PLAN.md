# PLAN — Reliability, privacy and cleanup overhaul

Branch: `improve/reliability-privacy` (from `origin/main` @ `7bddbe5`).

## Phase 0 findings

### Environment
| Check | Result |
|---|---|
| Remote | `origin` → `https://github.com/Arjav1512/CS50-FinalProject.git`, `main` tracks `origin/main` |
| `gh` | v2.82.1, logged in as `Arjav1512`, scopes include `repo`; viewer permission `ADMIN` → pushing and opening a PR is possible |
| Node | v22.20.0 (has `node --test` and `mock.timers` for `Date`) |
| Chrome | Google Chrome.app + Chrome for Testing in `~/.cache/puppeteer` → e2e should be runnable |
| Gemini model | ai.google.dev model page (fetched 2026-11-22): `gemini-3.8-flash` is "Stable", latest update September 2026. REST reference still documents `POST /v1beta/models/{model}:generateContent`; docs authenticate with the `x-goog-api-key` header. |

### Known problems — confirmed against the code
Each item from the task brief was checked in the source; all are real.

| # | Problem | Where (original code) |
|---|---|---|
| T1 | Session state only in worker memory | `trackingtabs.js:1-3` |
| T2 | `chrome.tabs.onActivated.dispatch` is not an API (throws) | `trackingtabs.js:319` |
| T3 | No idle detection | — (no `chrome.idle` anywhere) |
| T4 | `setInterval` in worker | `trackingtabs.js:446` |
| T5 | Racy read-modify-write of `activityLog` | `trackingtabs.js:108-127` |
| T6 | Log/summaries grow forever; retention never automatic | `options.js:218` only manual |
| D1 | `toLocaleString()` timestamps parsed with `new Date()` | `trackingtabs.js:103,249`; readers in `script.js`, `utils.js`, `options.js` |
| D2 | Exact-hostname category lookup; map duplicated | `utils.js:47-125`, `trackingtabs.js:134-212` |
| D3 | Streaks ignore gaps, 0 until today qualifies, hard-coded 1800 s | `utils.js:128-183` |
| P1 | All-pages content script sends page text; excluded domains not checked | `manifest.json:14-19`, `dataextraction.js` |
| P2 | Gemini key in source; retired `gemini-pro`; key in URL | `trackingtabs.js:216,234` |
| P3 | Summaries inserted with `innerHTML` | `script.js:288` (and all render functions) |
| P4 | Google Fonts loaded by popup | `ui.html:7-9`, `style.css:36` |
| P5 | README claims nothing leaves the device | `README.md:11,22,64,92` |
| P6 | Unused `identity`, `history`; `web_accessible_resources` exposes pages to all sites | `manifest.json:6,20-25` |
| F1 | "PDF" button downloads .txt | `script.js:725-750` |
| F2 | Custom range inputs never read | `script.js:546-554`, `utils.js:313` |
| F3 | Focus session is a popup `setTimeout`; goal type unused; `updateGoalProgress` never called; `chrome.notifications` without permission, missing `icon.png` | `script.js:567-618`, `trackingtabs.js:259-305` |
| F4 | Dead options: trackIncognito, streakGoal, enableNotifications, enableGoalReminders, notionTemplate, dataRetention | `options.js:175-199` (saved, never read) |
| F5 | Notion auto-export never runs; hard-coded `Title` property | `trackingtabs.js:326-393`, `script.js:646` |
| C1 | "Digital Digital Diary"; inconsistent names | `ui.html:199`, `options.html:280`, `manifest.json:3`, `ui.html:6` |
| C2 | `github.com/yourusername` placeholders | `options.js:78,82` |
| C3 | No icons; empty `package-lock.json` with no `package.json` | — |
| C4 | Duplicated Notion export / formatTime / summary text / category colours | `script.js`, `trackingtabs.js`, `options.js` |
| C5 | README future-improvements and file list out of date | `README.md:44-80` |

### Additional problems found (not in the brief)
| # | Problem | Where | Fix |
|---|---|---|---|
| X1 | `isExcludedUrl` uses `url.includes(domain)`, so excluding `x.com` also excludes `netflix.com`, `box.com`, etc. | `trackingtabs.js:75-77` | Match on normalized hostname (exact or subdomain); entries containing `://` are URL prefixes. |
| X2 | Navigating the active tab to an excluded URL returns early **without ending** the previous session, so that time is credited to the previous site. | `trackingtabs.js:44` | End the session first, then decide whether to start a new one. |
| X3 | `settings` is loaded asynchronously; any tab event before it resolves calls `settings.excludedDomains.some` on `undefined` and throws. | `trackingtabs.js:6-19,75` | Read settings from storage per operation (merged with defaults). |
| X4 | Nothing is tracked after browser start until the user switches tabs (no session is started for the already-active tab), and navigation in a tab is ignored unless it was activated first. | `trackingtabs.js:43` | Start a session on install/startup/focus/alarm tick when a focused window has an active tab. |
| X5 | Unknown categories (`misc`) silently get weight 5 because `categories['misc']` is undefined. | `utils.js:32` | Make the `misc` weight explicit (5, neutral) in the shared module. |
| X6 | Home "Score" is computed over the **whole history**, not today, while Notion export uses today's. | `script.js:170` | Home score uses today's activity. |
| X7 | `Utils.setTheme('auto')` stores the resolved theme, so "Auto (System)" is never remembered. | `utils.js:292-302` | Store `auto`, apply resolved theme. |
| X8 | "Reset All Settings" clears storage and restores only `activityLog`/`summaries`, losing anything else. "Clear All Data" also wipes settings/API keys although its confirmation says only activity data. | `options.js:259-274`, `script.js:869-876` | Reset removes only settings keys; Clear removes only data keys; confirmation texts say exactly what is removed. |
| X9 | "Export All Data" includes the Notion (and future Gemini) API keys in a JSON file users may share. | `script.js:862`, `options.js:212` | Export excludes secret keys; label/README say so. |
| X10 | Notion page content is a single rich_text object; Notion rejects text objects over 2000 characters. | `script.js:657-663` | Split into ≤2000-char chunks. |
| X11 | Achievements and streak chart use the hard-coded category map, ignoring any user choice. | `utils.js`, `script.js:493` | All category lookups go through the shared module with overrides. |
| X12 | Incognito tabs are tracked if the user allows the extension in incognito (the `trackIncognito` option did nothing). | `trackingtabs.js` | With `trackIncognito` removed (per decisions), incognito tabs are never tracked. Flagged in the PR. |

## Architecture after the change
- `lib/core.js` — pure ES module shared by worker, popup, options and tests: hostname normalization, category map + lookup with overrides, colours, `formatTime`, timestamps, migration, retention, streaks, score, achievements, date ranges, summary/report text, exclusion matching, default settings.
- `lib/tracker.js` — tracking engine (`createTracker(chrome)`): session in `chrome.storage.session`, one serial queue for every state/log write, minute flush, idle, focus, retention, focus sessions, data-clearing messages.
- `lib/notion.js`, `lib/gemini.js` — request builders (pure, unit-tested) + thin fetch wrappers.
- `trackingtabs.js` — module service worker; registers listeners synchronously and delegates to the tracker.
- `script.js` / `options.js` — ES modules; DOM built with `textContent`/elements only.

## Phases
0. Setup (this file) · 1. Test harness · 2. Tracking engine · 3. Data & categories · 4. Privacy · 5. Features · 6. Cleanup · 7. Independent verification · 8. PR
