# Digital Diary
**CS50x 2025 Final Project**
**Video URL:** https://youtu.be/ZR7ZmUQUYdw

---

## 🧠 What is Digital Diary?

Digital Diary is a lightweight Chrome extension designed to help users better understand their online behaviour, summarise their content consumption, and gently nudge them toward more mindful digital habits. Instead of overwhelming users with stats or analytics dashboards, this extension gives you a clean, minimal daily report of how you used your time online—categorised by purpose and powered by AI-generated summaries.

The extension tracks time spent on websites and categorises visited domains (e.g., "entertainment", "learning", "shopping"). Tracking data stays in your browser. Two optional features send data to outside services, and only when you click their buttons: **Summarize this page** (page text → Google Gemini) and **Export to Notion** (daily summary → Notion). See [Network requests](#-network-requests).

---

## 💡 Features Overview

- Logs websites visited and how long you spent on each
- Categorises those sites into helpful types like entertainment, learning, shopping, etc.
- Generates a simple daily digest (time spent, sites visited, categories)
- Optional, off by default: a "Summarize this page" button that sends the current tab's text to Google Gemini, only when clicked
- Offers personalised suggestions like “Try reading more tomorrow” if you're tilting too hard toward entertainment
- Tracking data is stored only in your browser; nothing is sent anywhere unless you click "Summarize this page" or "Export to Notion"

---

## ⚙️ Installation Instructions

1. Download or clone this repository.
2. Go to `chrome://extensions/` in your Chrome browser.
3. Enable “Developer mode” using the toggle in the top-right corner.
4. Click “Load unpacked” and select this folder.
5. You’ll see the extension icon in your toolbar—if not, pin it manually.
6. Start browsing! After visiting a few pages, click the extension icon to view your digital summary.

### 🔐 Setup Note (Gemini API Key)
AI summaries are off by default. To use them:
- Get a Gemini API key at [Google AI Studio](https://aistudio.google.com/app/apikey).
- Open the extension's **Full Settings**, tick **Enable "Summarize this page"** and paste the key.

Without the key, the extension still works—just without the summarisation feature.

---

## 🧩 File Breakdown

- `manifest.json`: The Chrome extension’s configuration file. Defines permissions, background scripts, content scripts, and the pop-up interface.
- `trackingtabs.js`: The engine of the project. It tracks tab activity, calculates time spent, stores log data, handles session timing, and talks to the Gemini API to fetch summaries of visited content. It also prevents tracking on Chrome internal pages.
- `dataextraction.js`: This script is injected into every page you visit. It scrapes content (articles, text, or fallback text from paragraphs) and sends that to the background script for AI summarisation.
- `script.js`: Powers the popup UI that you see when clicking the extension icon. It fetches all stored data, categorises it, and renders a visual breakdown with insights and learnings.
- `ui.html`: The popup HTML page. Serves as the user-facing front-end when you click the extension icon.
- `style.css`: Contains the minimal styling for the popup view. Clean, dark, and distraction-free.

---

## 🤔 Design Decisions

### Simplicity Over Complexity
I deliberately chose to keep the UI minimal—just a pop-up with essential summaries—rather than building an elaborate dashboard. The goal was to deliver meaningful insight without asking for attention.

### Gemini Integration
Instead of building a large NLP pipeline, I integrated Google’s Gemini API, which allows AI-powered summarisation with minimal setup. It’s fast, free (for reasonable use), and keeps things smart.

### Local Data
**All data is stored in `chrome.storage.local`.** No accounts, no syncing, no servers. Data only leaves the browser through the two buttons listed under [Network requests](#-network-requests).

### Categorisation Strategy
Rather than using a machine learning model to categorise websites (which could require training data and external APIs), I used a static mapping of popular domains to categories. It’s not exhaustive, but it works well enough for personal reflection.

---

## 🚧 Limitations & Future Improvements

- Right now, categorization only works for known domains. I’d like to explore heuristic or AI-based categorization in future versions.
- Summarization only works on text-heavy pages. It doesn't yet capture YouTube transcripts or podcast metadata.
- The extension only tracks active tabs, not background audio or multitasking scenarios.
- Goal Mode
- Export report to PDF
- Create a “7-day streak view”
- Use Notion API to sync these logs into a journal
- Score your day (like “Digital Productivity Score: 6/10”)

---

## 🌐 Network requests

Found by searching the code for every `fetch` call. With default settings the extension makes **no** network requests.

| When | What is sent | Where | Code |
|---|---|---|---|
| You click **Summarize this page** (only if enabled in settings and a key is set; never on excluded domains) | Page title + up to 3,000 characters of the current tab's text; your Gemini key in the `x-goog-api-key` header | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent` | `lib/gemini.js` |
| You click **Export to Notion** | Today's summary text (time per category, productivity score, today's AI summaries); your Notion key in the `Authorization` header | `https://api.notion.com/v1/pages` | `script.js` |
| You click **Test Connection** (Notion) | Database ID; your Notion key | `https://api.notion.com/v1/databases/{id}` | `script.js`, `options.js` |

---

## 📽️ Demo Video

👉 (https://youtu.be/ZR7ZmUQUYdw)

---

## 🔐 Disclaimer

All logs are stored locally in your browser. The extension sends nothing anywhere unless you click **Summarize this page** (Google Gemini) or **Export to Notion** (Notion).

---

## ✍️ Author Note

This extension was built as my final project for CS50x 2025. I wanted to build something I would personally use daily—something that nudges me toward better focus without nagging. I hope it helps others, too.
