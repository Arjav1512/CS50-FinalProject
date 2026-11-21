// Digital Diary service worker (Manifest V3, ES module).
// All listeners are registered synchronously at the top level so that Chrome
// can wake this worker for them after it has been stopped.

import { registerTracker } from './lib/tracker.js';

const tracker = registerTracker(chrome);

// --- Legacy page-summary handler (replaced in the privacy phase) -----------
const GEMINI_API_KEY = "YOUR_API_KEY_HERE";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== "summarize") return;
  tracker.getSettings().then(settings => {
    if (!settings.enableSummaries || GEMINI_API_KEY === "YOUR_API_KEY_HERE") return;
    const prompt = `Summarize the following webpage content in 2-3 bullet points with key takeaways:\n\n${msg.text}`;
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    })
      .then(res => res.json())
      .then(data => {
        const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "No summary available.";
        return tracker.run(async () => {
          const { summaries = [] } = await chrome.storage.local.get("summaries");
          summaries.push({ url: msg.url, summary, time: Date.now() });
          await chrome.storage.local.set({ summaries });
        });
      })
      .catch(err => console.error("[GEMINI ERROR]", err));
  });
});
