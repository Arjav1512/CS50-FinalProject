// Shared pure logic for Digital Diary.
// Imported by the service worker, the popup, the options page and the unit tests.
// Nothing in this file touches `chrome`, `document` or the network.

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

export function getCategoryForDomain(domain) {
  return CATEGORY_MAP[domain] || "misc";
}

export function formatTime(seconds) {
  seconds = Math.round(seconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

const SCORE_WEIGHTS = {
  "learning": 10,
  "productive": 8,
  "shopping": 3,
  "entertainment": 2,
  "social media": 1,
  "doomscrolling": 0
};

export function calculateProductivityScore(activityLog) {
  if (!activityLog || activityLog.length === 0) return 0;
  let totalTime = 0;
  let weightedScore = 0;
  activityLog.forEach(entry => {
    const category = getCategoryForDomain(entry.domain);
    const weight = SCORE_WEIGHTS[category] ?? 5;
    totalTime += entry.timeSpent;
    weightedScore += entry.timeSpent * weight;
  });
  if (totalTime === 0) return 0;
  return Math.min(100, Math.round((weightedScore / totalTime) * 10));
}

export function calculateStreak(activityLog) {
  if (!activityLog || activityLog.length === 0) {
    return { current: 0, longest: 0, lastActive: null };
  }
  const dailyActivity = {};
  activityLog.forEach(entry => {
    const date = new Date(entry.when).toDateString();
    if (!dailyActivity[date]) dailyActivity[date] = { totalTime: 0, productiveTime: 0 };
    const category = getCategoryForDomain(entry.domain);
    dailyActivity[date].totalTime += entry.timeSpent;
    if (['learning', 'productive'].includes(category)) {
      dailyActivity[date].productiveTime += entry.timeSpent;
    }
  });
  const dates = Object.keys(dailyActivity).sort((a, b) => new Date(b) - new Date(a));
  let currentStreak = 0, longestStreak = 0, tempStreak = 0;
  const today = new Date().toDateString();
  let checkingCurrent = true;
  dates.forEach(date => {
    if (dailyActivity[date].productiveTime >= 1800) {
      tempStreak++;
      if (checkingCurrent && (date === today || currentStreak > 0)) currentStreak = tempStreak;
    } else {
      checkingCurrent = false;
      longestStreak = Math.max(longestStreak, tempStreak);
      tempStreak = 0;
    }
  });
  longestStreak = Math.max(longestStreak, tempStreak);
  return { current: currentStreak, longest: longestStreak, lastActive: dates[0] || null };
}

const PRODUCTIVE = ['learning', 'productive'];

function hasProductiveTime(log, targetSeconds) {
  return log
    .filter(e => PRODUCTIVE.includes(getCategoryForDomain(e.domain)))
    .reduce((t, e) => t + e.timeSpent, 0) >= targetSeconds;
}

function hasWeeklyLearning(log, targetSeconds) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  return log
    .filter(e => new Date(e.when) >= oneWeekAgo && getCategoryForDomain(e.domain) === 'learning')
    .reduce((t, e) => t + e.timeSpent, 0) >= targetSeconds;
}

function hasBalancedDay(log) {
  const days = {};
  log.forEach(e => {
    const d = new Date(e.when).toDateString();
    days[d] = days[d] || { learning: false, entertainment: false };
    const c = getCategoryForDomain(e.domain);
    if (c === 'learning') days[d].learning = true;
    if (c === 'entertainment') days[d].entertainment = true;
  });
  return Object.values(days).some(d => d.learning && d.entertainment);
}

function hasEarlyActivity(log) {
  return log.some(e => new Date(e.when).getHours() < 9 && PRODUCTIVE.includes(getCategoryForDomain(e.domain)));
}

export function generateAchievements(activityLog, streakData) {
  const log = activityLog || [];
  return [
    { id: 'first_day', name: 'Getting Started', description: 'Complete your first day of tracking', icon: '🌱', unlocked: log.length > 0 },
    { id: 'productive_hour', name: 'Focused Hour', description: 'Spend 1 hour on productive activities', icon: '⏰', unlocked: hasProductiveTime(log, 3600) },
    { id: 'week_streak', name: 'Week Warrior', description: 'Maintain a 7-day productivity streak', icon: '🔥', unlocked: streakData.current >= 7 || streakData.longest >= 7 },
    { id: 'learning_master', name: 'Learning Master', description: 'Spend 5 hours learning in a week', icon: '📚', unlocked: hasWeeklyLearning(log, 18000) },
    { id: 'balanced_day', name: 'Balanced Life', description: 'Have a day with both learning and entertainment', icon: '⚖️', unlocked: hasBalancedDay(log) },
    { id: 'early_bird', name: 'Early Bird', description: 'Start productive work before 9 AM', icon: '🌅', unlocked: hasEarlyActivity(log) }
  ];
}

export function getDateRange(period, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'week': {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return { start: weekStart, end: now };
    }
    case 'month':
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: now };
    default:
      return { start: today, end: now };
  }
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

export function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
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
    const domain = entry.replace(/^\*\./, '').replace(/\/.*$/, '').replace(/^www\./, '');
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Timestamps and retention
// ---------------------------------------------------------------------------

// Returns epoch milliseconds, or NaN if the value is not a usable timestamp.
export function toTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return NaN;
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
