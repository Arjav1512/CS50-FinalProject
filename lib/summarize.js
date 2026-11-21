// "Summarize this page": runs only when the user clicks the popup button.
// Nothing is read or sent unless every check below passes.
import { isWebUrl, isExcludedUrl } from './core.js';
import { summarizeText, MAX_PAGE_CHARS } from './gemini.js';
import { extractPageText } from './page-text.js';

export async function summarizePage(chrome, tracker, tabId, fetchFn = fetch) {
  const settings = await tracker.getSettings();
  if (!settings.enableSummaries) {
    return { ok: false, error: 'AI summaries are turned off. Turn them on in Full Settings.' };
  }
  if (!settings.geminiApiKey) {
    return { ok: false, error: 'Add your Gemini API key in Full Settings first.' };
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isWebUrl(tab.url)) {
    return { ok: false, error: 'Only normal web pages can be summarized.' };
  }
  if (tab.incognito) {
    return { ok: false, error: 'Incognito pages are never summarized.' };
  }
  if (isExcludedUrl(tab.url, settings.excludedDomains)) {
    return { ok: false, error: 'This site is in your excluded domains, so it will not be summarized.' };
  }

  // Requires the activeTab grant, which Chrome gives when the user opens the popup.
  let page;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: extractPageText, args: [MAX_PAGE_CHARS] });
    page = injection?.result;
  } catch (err) {
    return { ok: false, error: `Could not read this page (${err.message}).` };
  }
  if (!page || !page.text || page.text.length < 50) {
    return { ok: false, error: 'There is not enough text on this page to summarize.' };
  }

  let summary;
  try {
    summary = await summarizeText(fetchFn, settings.geminiApiKey, page.text, page.title);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const item = { url: tab.url, title: page.title || '', summary, time: Date.now() };
  await tracker.run(async () => {
    const { summaries = [] } = await chrome.storage.local.get('summaries');
    summaries.push(item);
    await chrome.storage.local.set({ summaries });
  });
  return { ok: true, ...item };
}
