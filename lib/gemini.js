// Google Gemini client for the on-click "Summarize this page" feature.
// Model chosen from ai.google.dev (Models page, checked 2026-11-22):
// "gemini-3.8-flash" is listed as the current stable Flash model.
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
// At most this many characters of page text are sent.
export const MAX_PAGE_CHARS = 3000;

export function buildSummaryRequest(apiKey, pageText, title = '') {
  const text = String(pageText || '').slice(0, MAX_PAGE_CHARS);
  const prompt = 'Summarize the following web page in 2-3 short bullet points with the key takeaways. ' +
    `Reply in plain text.\n\nTitle: ${title}\n\n${text}`;
  return {
    url: GEMINI_ENDPOINT,                     // the API key is never put in the URL
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    }
  };
}

export function parseSummaryResponse(ok, status, json) {
  if (!ok) throw new Error(json?.error?.message || `Gemini request failed (HTTP ${status}).`);
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p.text || '').join('').trim();
  if (!text) {
    const reason = json?.promptFeedback?.blockReason;
    throw new Error(reason ? `Gemini declined to summarize this page (${reason}).` : 'Gemini returned no summary.');
  }
  return text;
}

export async function summarizeText(fetchFn, apiKey, pageText, title) {
  const { url, init } = buildSummaryRequest(apiKey, pageText, title);
  const res = await fetchFn(url, init);
  const json = await res.json().catch(() => null);
  return parseSummaryResponse(res.ok, res.status, json);
}
