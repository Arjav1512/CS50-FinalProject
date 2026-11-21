// Injected into ONE tab with chrome.scripting.executeScript, and only after the
// user clicks "Summarize this page". Must be self-contained (no imports or
// outer variables), because Chrome serializes the function source.
export function extractPageText() {
  let text = '';
  const article = document.querySelector('article');
  const main = article || ['main', '[role="main"]', '.post-content', '.article-content', '.entry-content', '.content']
    .map(sel => document.querySelector(sel)).find(Boolean);
  if (main) {
    text = main.innerText;
  } else {
    text = Array.from(document.querySelectorAll('p')).slice(0, 12).map(p => p.innerText).join('\n');
  }
  text = (text || '').replace(/\s+\n/g, '\n').trim();
  // Same limit as MAX_PAGE_CHARS in lib/gemini.js (this function cannot import it).
  return { title: document.title, text: text.slice(0, 3000) };
}
