# Controls — what every button and setting does

Each row is exercised by `npm run test:e2e` (real Chrome) and/or `npm test` (unit). "e2e:" names the check line printed by the e2e run.

## Popup (`ui.html` / `script.js`)

| Control | What it does | Evidence |
|---|---|---|
| Nav tabs: Home, Reports, Goals, Settings | Show the matching panel | e2e: popup screenshots (4 nav tabs each show their pane) |
| 🌙/☀️ header button | Switches light ↔ dark and saves `theme` | e2e: header: theme toggle switches and saves the theme |
| Score ring | Today's productivity score (0–100, time-weighted by category, uses your category changes) | e2e: category select … updates the score; unit: categories.test.js |
| Day Streak + bar | Consecutive days reaching the streak goal; bar = progress to 7 days | unit: streaks.test.js |
| Top Sites → category dropdown | Changes that site's category; saved in `categoryOverrides` and used everywhere (score, streaks, reports, focus, achievements). Picking the built-in category removes the override | e2e: home: category select saves an override …; unit: features.test.js |
| ✨ Summarize this page | If enabled + key set + not excluded: reads the current tab once (activeTab + scripting) and sends its text to Google Gemini; shows/stores the summary. Otherwise shows why it refused. Notice next to it: "Sends this page's text to Google Gemini." | e2e: summarize with default settings is refused and sends nothing; unit: privacy.test.js |
| 🎯 Focus Session (Home) | Opens the Goals tab with the minutes field focused | e2e: home: Focus Session button opens the focus panel |
| 📝 Export to Notion | Reads the database schema, then creates a page with today's summary (title → the title-type column; Date / Productivity Score only if they exist). Without settings, offers to open Full Settings | e2e: Export to Notion without settings …; unit: features.test.js (Notion); **real database: manual check** |
| Report Period (Today / This Week / This Month / Custom Range) | Chooses the range shown in the report | e2e: reports checks |
| From / To dates (Custom Range) | Inclusive custom range; start after end is rejected and download is disabled | e2e: reports: Custom Range …, valid custom range renders that range |
| 📄 Download report (.txt) | Downloads a plain-text report for the selected range | e2e: reports: "Download report (.txt)" … |
| 🔄 Refresh Data | Re-reads storage and redraws the report | e2e: reports: Refresh Data re-reads storage |
| Minutes + Start Focus Session | Starts a timer in the service worker (`chrome.alarms`), so it runs with the popup closed. 5–480 min | e2e: goals: Start Focus Session creates a worker alarm …; unit: features.test.js |
| Stop Session | Cancels the running focus session | e2e: goals: Stop Session clears the alarm |
| Focus result | When the session ends: notification (if enabled) "X of Y minutes were spent on learning/productive sites." | unit: focus session runs in the worker … notifies; **real notification: manual check** |
| Theme radios: Light / Dark / Auto (System) | Saves the theme; Auto follows the OS | e2e: settings: theme radio "Auto (System)" is saved as auto |
| 📤 Export Data (JSON) | Downloads all stored data except API keys | e2e: settings: Export Data (JSON) downloads data without API keys |
| 🗑️ Clear All Data | After confirmation, deletes activity, summaries, category changes and the focus session; keeps settings | e2e: settings: Clear All Data …; unit: features.test.js |
| Open Full Settings | Opens the options page | e2e: settings: Open Full Settings opens the options page |

## Options page (`options.html` / `options.js`)

All fields save automatically on change ("Saved" appears at the top).

| Control | What it does | Evidence |
|---|---|---|
| Notion API Key, Database ID | Used only by Export to Notion / Test Connection. Database ID may be the full URL | e2e: options: every field auto-saves |
| Test Connection | Validates input locally, then GETs the database and shows its name | e2e: options: Test Connection validates input locally; **real database: manual check** |
| Save Settings (Notion) | Saves the two Notion fields immediately | e2e: options: Save Settings (Notion) stores the key |
| Enable "Summarize this page" | Opt-in for the popup button (off by default) | e2e: auto-save; unit: privacy.test.js |
| Gemini API Key | Key for Summarize this page (sent only in the `x-goog-api-key` header) | e2e: auto-save; unit: privacy.test.js; **real key: manual check** |
| Minimum Tracking Time (1–60 s) | Visits shorter than this are not logged | e2e: auto-save (999 → 60); unit: tracker.test.js (short visits) |
| Excluded Domains | Never tracked, never summarized; a domain covers its subdomains | unit: tracker.test.js, categories.test.js, privacy.test.js |
| Daily Streak Goal (5–480 min) | Minutes of learning/productive time for a day to count | unit: streaks.test.js |
| Notify me when a focus session ends | Shows the focus-session notification | unit: features.test.js (both on and off) |
| Automatically delete activity older than (30 / 90 / 365 days / Keep forever) | Applied daily by a `chrome.alarms` alarm (and on browser start) | unit: tracker.test.js (retention) |
| 📤 Export Data (JSON) | Same as the popup's export (no API keys) | e2e: options: Export Data (JSON) works |
| 🧹 Clear Old Data Now | Applies the selected retention period immediately and reports what was deleted | e2e: options: Clear Old Data Now … |
| 🔄 Reset All Settings | Restores default settings (including removing API keys); keeps activity data | e2e: options: Reset All Settings …; unit: features.test.js |
| Statistics | Days tracked, total time, sites, longest streak | e2e: options: statistics are shown |
| 📋 View Source Code / 🐛 Report Issue | Links to github.com/Arjav1512/CS50-FinalProject (and /issues) | e2e: options: About links point to the real repository |

## Removed (they did nothing)

`Export Template` (notionTemplate), `Automatically export to Notion daily`, `Track incognito browsing`, `Remind me to set daily goals`, the goal-type dropdown (Focus/Learning/Limit), and the duplicate Notion fields in the popup's Settings tab.
