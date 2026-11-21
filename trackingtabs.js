// Digital Diary service worker (Manifest V3, ES module).
// All listeners are registered synchronously at the top level so that Chrome
// can wake this worker for them after it has been stopped.

import { registerTracker } from './lib/tracker.js';
import { summarizePage } from './lib/summarize.js';

const tracker = registerTracker(chrome);

// Messages from the extension's own pages (popup, options). There are no
// content scripts, and messages from anywhere else are ignored.
const messageHandlers = {
  summarizePage: msg => summarizePage(chrome, tracker, msg.tabId),
  startFocus: msg => tracker.startFocus(msg.minutes),
  stopFocus: () => tracker.stopFocus(),
  setCategory: msg => tracker.setCategory(msg.domain, msg.category),
  clearOldData: () => tracker.applyRetentionNow().then(r => ({ ok: true, ...r })),
  clearAllData: () => tracker.clearAllData(),
  resetSettings: () => tracker.resetSettings()
};

const fromOwnPage = sender => sender.id === chrome.runtime.id &&
  typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!fromOwnPage(sender) || !msg || !messageHandlers[msg.type]) return false;
  messageHandlers[msg.type](msg)
    .then(result => sendResponse(result ?? { ok: true }))
    .catch(err => sendResponse({ ok: false, error: err.message }));
  return true; // keep the channel open for the async response
});
