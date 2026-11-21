// Shared pure logic for Digital Diary.
// Imported by the service worker, the popup, the options page and the unit tests.
// Nothing in this file touches `chrome`, `document` or the network.

// Built-in site categories. Keys are normalized hostnames (see
// normalizeHostname); subdomains fall back to their parent domain.
export const CATEGORY_MAP = {
  // Learning & Education
  "wikipedia.org": "learning",
  "medium.com": "learning",
  "github.com": "productive",
  "stackoverflow.com": "learning",
  "coursera.org": "learning",
  "edx.org": "learning",
  "khanacademy.org": "learning",
  "udemy.com": "learning",
  "pluralsight.com": "learning",
  "codecademy.com": "learning",
  "freecodecamp.org": "learning",
  "bennett.edu.in": "learning",
  "scholar.google.com": "learning",
  "arxiv.org": "learning",
  "researchgate.net": "learning",

  // Productive Tools
  "chat.openai.com": "productive",
  "chatgpt.com": "productive",
  "claude.ai": "productive",
  "notion.so": "productive",
  "trello.com": "productive",
  "asana.com": "productive",
  "slack.com": "productive",
  "discord.com": "productive",
  "zoom.us": "productive",
  "meet.google.com": "productive",
  "docs.google.com": "productive",
  "drive.google.com": "productive",
  "dropbox.com": "productive",
  "figma.com": "productive",
  "canva.com": "productive",

  // Entertainment
  "youtube.com": "entertainment",
  "netflix.com": "entertainment",
  "twitch.tv": "entertainment",
  "spotify.com": "entertainment",
  "soundcloud.com": "entertainment",
  "reddit.com": "entertainment",
  "9gag.com": "entertainment",
  "imgur.com": "entertainment",
  "tiktok.com": "entertainment",
  "instagram.com": "entertainment",

  // Social Media
  "twitter.com": "social media",
  "x.com": "social media",
  "facebook.com": "social media",
  "linkedin.com": "social media",
  "snapchat.com": "social media",
  "whatsapp.com": "social media",
  "telegram.org": "social media",

  // Shopping
  "amazon.com": "shopping",
  "flipkart.com": "shopping",
  "ebay.com": "shopping",
  "etsy.com": "shopping",
  "shopify.com": "shopping",
  "myntra.com": "shopping",
  "ajio.com": "shopping",

  // News & Information
  "news.google.com": "learning",
  "bbc.com": "learning",
  "cnn.com": "learning",
  "reuters.com": "learning",
  "techcrunch.com": "learning",
  "theverge.com": "learning",
  "ycombinator.com": "learning",
  "hackernews.com": "learning"
};

export const CATEGORIES = ['learning', 'productive', 'entertainment', 'social media', 'shopping', 'misc'];
export const PRODUCTIVE_CATEGORIES = ['learning', 'productive'];

// Colours used by the popup's bars and tags (CSS custom properties from style.css).
export const CATEGORY_COLORS = {
  'learning': 'var(--success)',
  'productive': 'var(--accent-primary)',
  'entertainment': 'var(--danger)',
  'social media': 'var(--warning)',
  'shopping': '#8b5cf6',
  'misc': 'var(--text-muted)'
};

// Lowercase, drop a trailing dot, and strip a leading "www." and/or "m.".
export function normalizeHostname(hostname) {
  let h = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (h.startsWith('www.')) h = h.slice(4);
  if (h.startsWith('m.')) h = h.slice(2);
  return h;
}

// Candidate keys from most to least specific, e.g. "en.wikipedia.org" →
// ["en.wikipedia.org", "wikipedia.org"]. A bare TLD is never a candidate.
function domainCandidates(host) {
  const parts = host.split('.').filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'));
  if (out.length === 0 && host) out.push(host);
  return out;
}

// The most specific match wins (docs.google.com before google.com); at each
// level a user override beats the built-in map, so a site the user has
// re-categorised always uses the user's choice.
export function getCategory(domain, overrides = {}) {
  const host = normalizeHostname(domain);
  for (const candidate of domainCandidates(host)) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, candidate)) return overrides[candidate];
    if (Object.prototype.hasOwnProperty.call(CATEGORY_MAP, candidate)) return CATEGORY_MAP[candidate];
  }
  return 'misc';
}

export function isProductive(domain, overrides) {
  return PRODUCTIVE_CATEGORIES.includes(getCategory(domain, overrides));
}

export function formatTime(seconds) {
  seconds = Math.max(0, Math.round(Number(seconds) || 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export const SCORE_WEIGHTS = {
  'learning': 10,
  'productive': 8,
  'misc': 5,
  'shopping': 3,
  'entertainment': 2,
  'social media': 1
};

// 0–100: time-weighted average of the category weights above, ×10.
export function calculateProductivityScore(activityLog, overrides = {}) {
  let totalTime = 0;
  let weighted = 0;
  for (const entry of activityLog || []) {
    const t = Number(entry.timeSpent) || 0;
    totalTime += t;
    weighted += t * (SCORE_WEIGHTS[getCategory(entry.domain, overrides)] ?? SCORE_WEIGHTS.misc);
  }
  if (totalTime === 0) return 0;
  return Math.min(100, Math.round((weighted / totalTime) * 10));
}

// ---------------------------------------------------------------------------
// Days, streaks and achievements
// ---------------------------------------------------------------------------

// Local calendar day, "YYYY-MM-DD".
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftDay(key, delta) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + delta).getTime());
}

export function productiveSecondsByDay(activityLog, overrides = {}) {
  const days = {};
  for (const entry of activityLog || []) {
    const ts = toTimestamp(entry.when);
    if (Number.isNaN(ts) || !isProductive(entry.domain, overrides)) continue;
    const key = dayKey(ts);
    days[key] = (days[key] || 0) + (Number(entry.timeSpent) || 0);
  }
  return days;
}

// A day counts when its learning/productive time reaches `goalMinutes`.
// Only consecutive calendar days form a streak. If today has not reached the
// goal yet, the current streak still counts up to yesterday.
export function calculateStreak(activityLog, { goalMinutes = 30, overrides = {}, now = Date.now() } = {}) {
  const goalSeconds = Math.max(1, Number(goalMinutes) || 30) * 60;
  const byDay = productiveSecondsByDay(activityLog, overrides);
  const qualifies = key => (byDay[key] || 0) >= goalSeconds;

  const today = dayKey(now);
  let cursor = qualifies(today) ? today : shiftDay(today, -1);
  let current = 0;
  while (qualifies(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of Object.keys(byDay).filter(qualifies).sort()) {
    run = prev && shiftDay(prev, 1) === key ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = key;
  }
  return { current, longest: Math.max(longest, current), todayDone: qualifies(today) };
}

export function generateAchievements(activityLog, streakData, overrides = {}, now = Date.now()) {
  const log = (activityLog || []).filter(e => !Number.isNaN(toTimestamp(e.when)));
  const cat = e => getCategory(e.domain, overrides);
  const sum = list => list.reduce((t, e) => t + (Number(e.timeSpent) || 0), 0);
  const weekAgo = now - 7 * 86400000;
  const perDay = {};
  for (const e of log) {
    const k = dayKey(e.when);
    perDay[k] = perDay[k] || new Set();
    perDay[k].add(cat(e));
  }
  return [
    { id: 'first_day', name: 'Getting Started', description: 'Complete your first day of tracking', icon: '🌱', unlocked: log.length > 0 },
    { id: 'productive_hour', name: 'Focused Hour', description: 'Spend 1 hour on productive activities', icon: '⏰', unlocked: sum(log.filter(e => PRODUCTIVE_CATEGORIES.includes(cat(e)))) >= 3600 },
    { id: 'week_streak', name: 'Week Warrior', description: 'Maintain a 7-day productivity streak', icon: '🔥', unlocked: streakData.current >= 7 || streakData.longest >= 7 },
    { id: 'learning_master', name: 'Learning Master', description: 'Spend 5 hours learning in a week', icon: '📚', unlocked: sum(log.filter(e => e.when >= weekAgo && cat(e) === 'learning')) >= 18000 },
    { id: 'balanced_day', name: 'Balanced Life', description: 'Have a day with both learning and entertainment', icon: '⚖️', unlocked: Object.values(perDay).some(s => s.has('learning') && s.has('entertainment')) },
    { id: 'early_bird', name: 'Early Bird', description: 'Start productive work before 9 AM', icon: '🌅', unlocked: log.some(e => new Date(e.when).getHours() < 9 && PRODUCTIVE_CATEGORIES.includes(cat(e))) }
  ];
}

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

// "YYYY-MM-DD" (from <input type="date">) → local midnight, or null.
export function parseDateInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

// Returns { start, end } as Dates, or { error } for an invalid custom range.
// Custom ranges include the whole end day.
export function getDateRange(period, now = new Date(), custom = {}) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'week': {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return { start: weekStart, end: now };
    }
    case 'month':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: now };
    case 'custom': {
      const start = parseDateInput(custom.start);
      const endDay = parseDateInput(custom.end);
      if (!start || !endDay) return { error: 'Choose both a start and an end date.' };
      if (start > endDay) return { error: 'The start date must be on or before the end date.' };
      const end = new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 23, 59, 59, 999);
      return { start, end };
    }
    default:
      return { start: today, end: now };
  }
}

export function filterByRange(items, start, end, field = 'when') {
  const s = start.getTime();
  const e = end.getTime();
  return (items || []).filter(item => {
    const ts = toTimestamp(item[field]);
    return !Number.isNaN(ts) && ts >= s && ts <= e;
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = Object.freeze({
  minTrackingTime: 5,          // seconds; shorter visits are not logged
  excludedDomains: ['localhost'],
  enableSummaries: false,      // AI summaries are opt-in
  geminiApiKey: '',
  notionApiKey: '',
  notionDatabaseId: '',
  streakGoal: 30,              // minutes of learning/productive time per day
  enableNotifications: true,   // focus-session notifications
  dataRetention: 90,           // days; 0 = keep forever
  theme: 'dark'
});

export function withDefaults(stored = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (stored[key] !== undefined && stored[key] !== null) out[key] = stored[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// URLs and exclusions
// ---------------------------------------------------------------------------

// Normalized hostname of a URL ("https://www.YouTube.com/x" → "youtube.com").
export function hostnameOf(url) {
  try {
    return normalizeHostname(new URL(url).hostname);
  } catch {
    return '';
  }
}

// Only ordinary web pages are ever tracked or summarised.
export function isWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// An excluded entry is either a URL prefix (contains "://", e.g. "chrome://")
// or a domain that matches itself and its subdomains ("example.com" excludes
// "www.example.com" but NOT "notexample.com").
export function isExcludedUrl(url, excludedDomains = []) {
  if (!isWebUrl(url)) return true;
  const lowerUrl = url.toLowerCase();
  const host = hostnameOf(url);
  for (const raw of excludedDomains || []) {
    const entry = String(raw).trim().toLowerCase();
    if (!entry) continue;
    if (entry.includes('://')) {
      if (lowerUrl.startsWith(entry)) return true;
      continue;
    }
    const domain = normalizeHostname(entry.replace(/^\*\./, '').replace(/\/.*$/, ''));
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Timestamps and retention
// ---------------------------------------------------------------------------

// Returns epoch milliseconds, or NaN if the value is not a usable timestamp.
// Since schema version 2 every timestamp is stored as Date.now() (a number);
// legacy text is converted once by migrateStorage().
export function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return NaN;
}

// ---------------------------------------------------------------------------
// Migration of data written by version 1.0
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 2;

// Settings that 1.0 stored but that no longer exist.
export const REMOVED_KEYS = ['currentGoal', 'notionTemplate', 'autoExportNotion', 'trackIncognito', 'enableGoalReminders', 'lastNotionExport'];

const LEGACY_RE = /^(\d{1,4})([./-])(\d{1,2})\2(\d{1,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?\.?\s?(m)?\.?$/i;

function splitLegacy(text) {
  // Chrome's toLocaleString() may use U+202F / U+00A0 before AM/PM.
  const m = LEGACY_RE.exec(String(text).replace(/[\u202f\u00a0]/g, ' ').trim());
  if (!m) return null;
  return { a: Number(m[1]), sep: m[2], b: Number(m[3]), c: Number(m[4]), aLen: m[1].length,
    h: Number(m[5]), mi: Number(m[6]), s: Number(m[7] || 0), ampm: m[8] || null };
}

// Looks at all legacy strings of one profile (they were all written with the
// same browser locale) to decide between month/day and day/month order.
export function detectDateOrder(strings) {
  let dmy = 0, mdy = 0;
  for (const str of strings) {
    const p = splitLegacy(str);
    if (!p || p.aLen === 4) continue;
    if (p.a > 12 && p.b <= 12) dmy++;
    else if (p.b > 12 && p.a <= 12) mdy++;
  }
  if (dmy > mdy) return 'dmy';
  if (mdy > dmy) return 'mdy';
  return null;
}

// Parses text produced by `new Date().toLocaleString()` in common locales:
//   en-US "11/22/2026, 3:45:12 PM"   en-GB "22/11/2026, 15:45:12"
//   en-IN "22/11/2026, 3:45:12 pm"   de-DE "22.11.2026, 15:45:12"
//   sv-SE "2026-11-22 15:45:12"      plus ISO 8601 strings.
// `order` ('dmy' | 'mdy' | null) resolves ambiguous dates such as 03/04/2026.
// Returns epoch ms, or NaN when the text cannot be read with confidence.
export function parseLegacyTimestamp(text, order = null) {
  if (typeof text === 'number') return toTimestamp(text);
  if (typeof text !== 'string') return NaN;
  const p = splitLegacy(text);
  if (!p) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text.trim())) {
      const t = Date.parse(text.trim());
      return Number.isNaN(t) ? NaN : t;
    }
    return NaN;
  }
  let year, month, day;
  if (p.aLen === 4) {                       // Y-M-D
    [year, month, day] = [p.a, p.b, p.c];
  } else {
    year = p.c < 100 ? 2000 + p.c : p.c;
    let dayFirst;
    if (p.sep === '.') dayFirst = true;      // dotted dates are day-first
    else if (p.a > 12) dayFirst = true;
    else if (p.b > 12) dayFirst = false;
    else if (order) dayFirst = order === 'dmy';
    else if (p.ampm) dayFirst = p.ampm === p.ampm.toLowerCase(); // en-US: "PM", en-IN: "pm"
    else dayFirst = true;                    // 24-hour clock with slashes: en-GB style
    [day, month] = dayFirst ? [p.a, p.b] : [p.b, p.a];
  }
  let hour = p.h;
  if (p.ampm) {
    if (hour < 1 || hour > 12) return NaN;
    hour = (hour % 12) + (p.ampm.toLowerCase() === 'p' ? 12 : 0);
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || p.mi > 59 || p.s > 59) return NaN;
  const d = new Date(year, month - 1, day, hour, p.mi, p.s);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return NaN;   // e.g. 31/02
  return d.getTime();
}

// Pure migration of a full chrome.storage.local snapshot from schema 1 to 2.
// Returns null when nothing needs doing, otherwise { set, remove, report }.
// No entry is ever dropped: entries whose date cannot be read are kept as-is
// and counted in report.unparsed.
export function migrateStorage(data, now = Date.now()) {
  const from = Number(data.schemaVersion) || 1;
  if (from >= SCHEMA_VERSION) return null;

  const log = Array.isArray(data.activityLog) ? data.activityLog : [];
  const summaries = Array.isArray(data.summaries) ? data.summaries : [];
  const order = detectDateOrder([...log.map(e => e.when), ...summaries.map(s => s.time)].filter(v => typeof v === 'string'));

  let converted = 0, unparsed = 0, summariesConverted = 0, summariesUnparsed = 0;
  const activityLog = log.map((entry, i) => {
    const out = { ...entry };
    delete out.category;                        // categories are computed at read time now
    if (out.id === undefined) out.id = `legacy-${i}`;
    if (typeof out.domain === 'string') out.domain = normalizeHostname(out.domain);
    if (typeof entry.when === 'number') return out;
    const end = parseLegacyTimestamp(entry.when, order);
    if (Number.isNaN(end)) { unparsed++; return out; }
    converted++;
    // Version 1.0 stored the moment the visit ENDED; 2 stores when it started.
    out.when = end - (Number(entry.timeSpent) || 0) * 1000;
    return out;
  });
  const newSummaries = summaries.map(item => {
    if (typeof item.time === 'number') return { ...item };
    const t = parseLegacyTimestamp(item.time, order);
    if (Number.isNaN(t)) { summariesUnparsed++; return { ...item }; }
    summariesConverted++;
    return { ...item, time: t };
  });

  const report = { from, to: SCHEMA_VERSION, at: now, dateOrder: order, total: log.length, converted, unparsed, summariesConverted, summariesUnparsed };
  const set = { activityLog, summaries: newSummaries, schemaVersion: SCHEMA_VERSION, migrationReport: report };
  // AI summaries used to run automatically on every page; the new on-click
  // feature is opt-in, so any old "enabled" value is reset.
  if ('enableSummaries' in data) set.enableSummaries = false;
  // Version 1.0 never deleted anything automatically. So that updating cannot
  // silently delete existing history, upgraded profiles start with
  // "Keep forever"; the user can choose a retention period in settings.
  if (log.length > 0) {
    set.dataRetention = 0;
    report.retentionWas = data.dataRetention ?? null;
  }
  const remove = REMOVED_KEYS.filter(k => k in data);
  return { set, remove, report };
}

// Keeps items newer than `days` days. Items whose timestamp cannot be read are
// always kept (never silently deleted). days <= 0 keeps everything.
export function applyRetention(items, days, now = Date.now(), field = 'when') {
  const list = items || [];
  if (!days || days <= 0) return list;
  const cutoff = now - days * 86400000;
  return list.filter(item => {
    const ts = toTimestamp(item[field]);
    return Number.isNaN(ts) || ts >= cutoff;
  });
}
