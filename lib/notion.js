// Notion export (manual only: runs when the user clicks "Export to Notion" or
// "Test Connection"). Uses the Notion REST API from the extension page.
export const NOTION_API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2022-06-28';
const MAX_TEXT = 2000; // Notion's limit per rich_text object

// Accepts a raw ID (with or without dashes) or a full database URL.
export function normalizeDatabaseId(input) {
  const compact = String(input || '').replace(/-/g, '');
  const match = compact.match(/[0-9a-f]{32}/i);
  return match ? match[0].toLowerCase() : '';
}

// Chooses which database properties to fill. The title property is whichever
// one has type "title" (new databases call it "Name"). "Date" and
// "Productivity Score" are only set if they exist with the right type.
export function pickProperties(schemaProperties = {}) {
  const entries = Object.entries(schemaProperties);
  const title = entries.find(([, p]) => p.type === 'title')?.[0] || null;
  const date = entries.find(([name, p]) => name === 'Date' && p.type === 'date')?.[0] || null;
  const score = entries.find(([name, p]) => name === 'Productivity Score' && p.type === 'number')?.[0] || null;
  return { title, date, score };
}

export function chunkText(text, size = MAX_TEXT) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks.length ? chunks : [''];
}

export function buildPageBody(databaseId, props, { title, isoDate, text, score }) {
  const properties = { [props.title]: { title: [{ text: { content: title } }] } };
  if (props.date) properties[props.date] = { date: { start: isoDate } };
  if (props.score) properties[props.score] = { number: score };
  const children = text.split('\n').filter(line => line.trim()).flatMap(line =>
    chunkText(line).map(chunk => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: chunk } }] }
    })));
  return { parent: { database_id: databaseId }, properties, children: children.slice(0, 100) };
}

const headers = apiKey => ({
  'Authorization': `Bearer ${apiKey}`,
  'Notion-Version': NOTION_VERSION,
  'Content-Type': 'application/json'
});

async function notionJson(res) {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || `Notion request failed (HTTP ${res.status}).`);
  return json;
}

export async function getDatabase(fetchFn, apiKey, databaseId) {
  const id = normalizeDatabaseId(databaseId);
  if (!apiKey || !id) throw new Error('Enter your Notion API key and a valid database ID.');
  const res = await fetchFn(`${NOTION_API}/databases/${id}`, { headers: headers(apiKey) });
  return notionJson(res);
}

export function databaseTitle(db) {
  return (db.title || []).map(t => t.plain_text || '').join('') || 'Untitled';
}

// Reads the schema first, then creates one page. Returns what was written.
export async function exportToNotion(fetchFn, { apiKey, databaseId, title, isoDate, text, score }) {
  const db = await getDatabase(fetchFn, apiKey, databaseId);
  const props = pickProperties(db.properties);
  if (!props.title) throw new Error('That Notion database has no title property.');
  const body = buildPageBody(normalizeDatabaseId(databaseId), props, { title, isoDate, text, score });
  const res = await fetchFn(`${NOTION_API}/pages`, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(body) });
  const page = await notionJson(res);
  return { url: page.url, props };
}
