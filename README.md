# Digital Digital Diary
**CS50x 2025 Final Project**
**Video URL:** https://youtu.be/ZR7ZmUQUYdw

---

## 🧠 What is Digital Digital Diary?

Digital Digital Diary is a lightweight Chrome extension designed to help users better understand their online behavior, summarize their content consumption, and gently nudge them toward more mindful digital habits. Instead of overwhelming users with stats or analytics dashboards, this extension gives you a clean, minimal daily report of how you used your time online—categorized by purpose and powered by AI-generated summaries.

Built to be non-intrusive and fully local, the extension tracks time spent on websites, categorizes visited domains (e.g., "entertainment", "learning", "shopping"), and uses Google Gemini (via its API) to provide key takeaways from articles and media you consume. The goal is to help users reflect on their day and even extract value from what might otherwise be passive browsing.

---

## 💡 Features Overview

- Logs websites visited and how long you spent on each
- Categorizes those sites into helpful types like entertainment, learning, shopping, etc.
- Generates a simple daily digest (time spent, sites visited, categories)
- Uses Google Gemini AI to summarize what you read or watched (like news articles or YouTube podcasts)
- Offers personalized suggestions like “Try reading more tomorrow” if you're tilting too hard toward entertainment
- Does not track or upload any personal data — everything runs locally in your browser

---

## ⚙️ Installation Instructions

1. Download or clone this repository.
2. Go to `chrome://extensions/` in your Chrome browser.
3. Enable “Developer mode” using the toggle in the top-right corner.
4. Click “Load unpacked” and select this folder.
5. You’ll see the extension icon in your toolbar—if not, pin it manually.
6. Start browsing! After visiting a few pages, click the extension icon to view your digital summary.

### 🔐 Setup Note (Gemini API Key)
To enable AI summaries:
- Head to [https://makersuite.google.com/app/apikey](https://makersuite.google.com/app/apikey) and get your free Google Gemini API key.
- Paste that key in `trackingtabs.js` where it says `YOUR_API_KEY_HERE`.

Without the key, the extension still works—just without the summarization feature.

---

## 🧩 File Breakdown

- `manifest.json`: The Chrome extension’s configuration file. Defines permissions, background scripts, content scripts, and popup interface.
- `trackingtabs.js`: The engine of the project. It tracks tab activity, calculates time spent, stores log data, handles session timing, and talks to the Gemini API to fetch summaries of visited content. It also prevents tracking on Chrome internal pages.
- `dataextraction.js`: This script is injected into every page you visit. It scrapes content (articles, text, or fallback text from paragraphs) and sends that to the background script for AI summarization.
- `script.js`: Powers the popup UI that you see when clicking the extension icon. It fetches all stored data, categorizes it, and renders a visual breakdown with insights and learnings.
- `ui.html`: The popup HTML page. Serves as the user-facing front-end when you click the extension icon.
- `style.css`: Contains the minimal styling for the popup view. Clean, dark, and distraction-free.

---

## 🤔 Design Decisions

### Simplicity Over Complexity
I deliberately chose to keep the UI minimal—just a popup with essential summaries—rather than building an elaborate dashboard. The goal was to deliver meaningful insight without asking for attention.

### Gemini Integration
Instead of building a large NLP pipeline, I integrated Google’s Gemini API, which allows AI-powered summarization with minimal setup. It’s fast, free (for reasonable use), and keeps things smart.

### Local-Only Data
User trust was important, so I ensured that **all data is stored in `chrome.storage.local`** and never leaves the user’s machine. No accounts, no syncing, no servers.

### Categorization Strategy
Rather than using a machine learning model to categorize websites (which could require training data and external APIs), I used a static mapping of popular domains to categories. It’s not exhaustive, but it works well enough for personal reflection.

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

## 📽️ Demo Video

👉 (https://youtu.be/ZR7ZmUQUYdw)

---

## 🔐 Disclaimer

This extension doesn’t upload or share anything. All logs are stored locally on your browser. You’re the only one who can see them. It’s just a mirror to help you understand where your digital time goes.

---

## ✍️ Author Note

This extension was built as my final project for CS50x 2025. I wanted to build something I would personally use daily—something that nudges me toward better focus without nagging. I hope it helps others too.

Thanks for reading.
