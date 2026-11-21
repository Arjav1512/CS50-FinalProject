// Digital Diary popup.
// All rendering builds DOM nodes; stored or fetched text is only ever inserted
// as text (see lib/ui.js). Data changes go through the service worker so they
// share its single write queue.

import {
  CATEGORIES, CATEGORY_COLORS, getCategory, formatTime, calculateProductivityScore,
  calculateStreak, generateAchievements, getDateRange, filterByRange, dayKey,
  productiveSecondsByDay, timeByCategory, timeByDomain, buildDailySummaryText,
  buildReportText, focusResultMessage, withDefaults, DEFAULT_SETTINGS,
  totalSeconds, secondsByDay, dayBounds, summaryLabel, nextMilestone
} from './lib/core.js';
import { h, setChildren, downloadFile, todayStamp, applyTheme, sendToWorker, storageGet, storageSet, showStatus, exportDataFile } from './lib/ui.js';
import { exportToNotion } from './lib/notion.js';

const PERIOD_LABELS = { today: 'Today', week: 'This Week', month: 'This Month', custom: 'Custom Range' };
const $ = id => document.getElementById(id);

const state = {
  tab: 'home',
  log: [],
  summaries: [],
  overrides: {},
  settings: withDefaults(),
  focusSession: null
};
let focusTimer = null;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadData() {
  const data = await storageGet(['activityLog', 'summaries', 'categoryOverrides', 'focusSession', ...Object.keys(DEFAULT_SETTINGS)]);
  state.log = data.activityLog || [];
  state.summaries = data.summaries || [];
  state.overrides = data.categoryOverrides || {};
  state.focusSession = data.focusSession || null;
  state.settings = withDefaults(data);
}

const category = domain => getCategory(domain, state.overrides);
// The whole local calendar day (visits are counted on the day they started).
const todayRange = () => dayBounds(Date.now());
const todaysActivity = () => { const { start, end } = todayRange(); return filterByRange(state.log, start, end); };
const todaysSummaries = () => { const { start, end } = todayRange(); return filterByRange(state.summaries, start, end, 'time'); };
const streak = () => calculateStreak(state.log, { goalMinutes: state.settings.streakGoal, overrides: state.overrides });

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function categoryBars(categoryTime, showPercent) {
  const total = Object.values(categoryTime).reduce((a, b) => a + b, 0);
  return h('div', { class: 'category-breakdown' }, Object.entries(categoryTime)
    .sort((a, b) => b[1] - a[1])
    .filter(([, seconds]) => showPercent || seconds >= 60)
    .map(([cat, seconds]) => {
      const pct = Math.round((seconds / Math.max(1, total)) * 100);
      return h('div', { class: 'category-bar-row' },
        h('div', { class: 'category-bar-header' },
          h('span', { class: 'activity-domain' }, cat),
          h('span', { class: 'activity-time' }, showPercent ? `${formatTime(seconds)} · ${pct}%` : formatTime(seconds))),
        h('div', { class: 'category-bar-track' },
          h('div', { class: 'category-bar-fill', style: { width: `${pct}%`, background: CATEGORY_COLORS[cat] || 'var(--text-muted)' } })));
    }));
}

// Text derived from a web page (via Gemini) — inserted as text only.
function summaryCard(item) {
  return h('div', { class: 'summary-item' }, h('strong', {}, summaryLabel(item)), h('p', {}, item.summary));
}

// Lets the user change a site's category; saved as an override and used everywhere.
function categorySelect(domain) {
  const current = category(domain);
  return h('select', {
    class: 'category-select',
    'aria-label': `Category for ${domain}`,
    title: 'Change this site\'s category',
    onchange: async e => {
      const select = e.target;
      select.disabled = true;
      const result = await sendToWorker({ type: 'setCategory', domain, category: select.value }).catch(err => ({ ok: false, error: err.message }));
      // On success storage changes and the list re-renders; on failure restore it.
      if (!result?.ok) { select.value = current; select.disabled = false; alert(result?.error || 'Could not change the category.'); }
    }
  }, CATEGORIES.map(c => h('option', { value: c, selected: c === current }, c)));
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function renderHome() {
  const today = todaysActivity();
  const score = calculateProductivityScore(today, state.overrides);
  $('productivityScore').textContent = score;
  const circumference = 326.73; // r = 52
  $('scoreRingFill').style.strokeDashoffset = circumference - (score / 100) * circumference;

  const s = streak();
  const milestone = nextMilestone(s.current);
  $('currentStreak').textContent = s.current;
  $('streakProgress').style.width = `${Math.min(100, (s.current / milestone) * 100)}%`;
  $('milestoneText').textContent = `Next milestone: ${milestone} days`;

  const box = $('todayReport');
  if (today.length === 0) {
    setChildren(box, h('h3', {}, "Today's Activity"), h('div', { class: 'loading' }, 'No activity recorded today. Start browsing!'));
    return;
  }
  const nodes = [h('h3', {}, "Today's Activity"), categoryBars(timeByCategory(today, state.overrides), false)];
  const top = Object.entries(timeByDomain(today)).sort((a, b) => b[1] - a[1]).slice(0, 5);
  nodes.push(h('h4', { style: { marginTop: '16px', marginBottom: '8px' } }, 'Top Sites'));
  nodes.push(h('ul', { class: 'activity-list' }, top.map(([domain, seconds]) =>
    h('li', { class: 'activity-item' },
      h('div', {}, h('span', { class: 'activity-domain' }, domain), categorySelect(domain)),
      h('span', { class: 'activity-time' }, formatTime(seconds))))));
  const sums = todaysSummaries().slice(-2);
  if (sums.length) {
    nodes.push(h('h4', { style: { marginTop: '16px', marginBottom: '8px' } }, 'Key Takeaways'));
    sums.forEach(item => nodes.push(summaryCard(item)));
  }
  setChildren(box, nodes);
}

async function summarizeCurrentPage() {
  const button = $('summarizeBtn');
  const out = $('summaryResult');
  button.disabled = true;
  setChildren(out, h('div', { class: 'loading' }, 'Summarizing…'));
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = tab ? await sendToWorker({ type: 'summarizePage', tabId: tab.id }) : { ok: false, error: 'No active tab.' };
    if (result && result.ok) setChildren(out, summaryCard(result));
    else setChildren(out, h('div', { class: 'status-message error', style: { display: 'block' } }, result?.error || 'Could not summarize this page.'));
  } catch (err) {
    setChildren(out, h('div', { class: 'status-message error', style: { display: 'block' } }, err.message));
  } finally {
    button.disabled = false;
  }
}

async function exportTodayToNotion() {
  const button = $('exportNotionBtn');
  const { notionApiKey, notionDatabaseId } = state.settings;
  if (!notionApiKey || !notionDatabaseId) {
    if (confirm('Notion is not set up yet. Open Full Settings to add your Notion API key and database ID?')) chrome.runtime.openOptionsPage();
    return;
  }
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Exporting…';
  try {
    const today = todaysActivity();
    await exportToNotion(fetch, {
      apiKey: notionApiKey,
      databaseId: notionDatabaseId,
      title: `Digital Diary - ${new Date().toLocaleDateString()}`,
      isoDate: todayStamp(),
      text: buildDailySummaryText(today, todaysSummaries(), state.overrides),
      score: calculateProductivityScore(today, state.overrides)
    });
    alert('✅ Exported today\'s summary to Notion.');
  } catch (err) {
    alert(`❌ Notion export failed: ${err.message}`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function currentRange() {
  const period = $('dateRange').value;
  const range = getDateRange(period, new Date(), { start: $('startDate').value, end: $('endDate').value });
  return { period, label: PERIOD_LABELS[period], ...range };
}

function renderReports() {
  const custom = $('dateRange').value === 'custom';
  $('customDateRange').classList.toggle('hidden', !custom);
  const range = currentRange();
  const box = $('reportContent');
  if (range.error) {
    showStatus($('rangeError'), 'error', range.error, 0);
    setChildren(box);
    $('downloadReportBtn').disabled = true;
    return;
  }
  $('rangeError').className = 'status-message';
  $('rangeError').textContent = '';
  $('downloadReportBtn').disabled = false;

  const activities = filterByRange(state.log, range.start, range.end);
  if (activities.length === 0) {
    setChildren(box, h('p', {}, 'No activity data for the selected period.'));
    return;
  }
  const total = totalSeconds(activities);
  const perDay = secondsByDay(activities);
  const days = Object.keys(perDay).length;
  const nodes = [
    h('div', { class: 'report-summary' },
      h('h4', {}, `${range.label} Summary`),
      h('p', {}, h('strong', {}, 'Total Time Tracked:'), ` ${formatTime(total)}`),
      h('p', {}, h('strong', {}, 'Days Active:'), ` ${days}`),
      h('p', {}, h('strong', {}, 'Average Daily Time:'), ` ${formatTime(total / Math.max(1, days))}`)),
    h('h4', { style: { marginTop: '20px' } }, 'Time by Category'),
    categoryBars(timeByCategory(activities, state.overrides), true)
  ];
  if (days > 1) {
    nodes.push(h('h4', { style: { marginTop: '20px' } }, 'Daily Activity'));
    nodes.push(h('ul', { class: 'activity-list' }, Object.entries(perDay)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 31)
      .map(([key, seconds]) => {
        const [y, m, d] = key.split('-').map(Number);
        return h('li', { class: 'activity-item' },
          h('span', { class: 'activity-domain' }, new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })),
          h('span', { class: 'activity-time' }, formatTime(seconds)));
      })));
  }
  setChildren(box, nodes);
}

function downloadReport() {
  const range = currentRange();
  if (range.error) return;
  const activities = filterByRange(state.log, range.start, range.end);
  const text = buildReportText(activities, { label: range.label, start: range.start, end: range.end }, state.overrides);
  downloadFile(`digital-diary-report-${range.period}-${todayStamp()}.txt`, text, 'text/plain');
}

// ---------------------------------------------------------------------------
// Goals: focus session, achievements, streak chart
// ---------------------------------------------------------------------------

function renderFocus() {
  clearInterval(focusTimer);
  focusTimer = null;
  const box = $('focusDisplay');
  const f = state.focusSession;
  $('startFocusBtn').disabled = !!f?.active;
  if (f?.active) {
    const fill = h('div', { class: 'progress-fill' });
    const remaining = h('p', {});
    const tick = () => {
      const left = Math.max(0, Math.round((f.endTime - Date.now()) / 1000));
      remaining.textContent = left > 0 ? `${formatTime(left)} remaining` : 'Finishing…';
      fill.style.width = `${Math.min(100, ((f.duration - left) / f.duration) * 100)}%`;
    };
    tick();
    focusTimer = setInterval(tick, 1000);
    setChildren(box, h('div', { class: 'active-goal' },
      h('h5', {}, `Focus session · ${Math.round(f.duration / 60)} min`),
      h('div', { class: 'goal-progress' }, h('div', { class: 'progress-bar' }, fill), remaining),
      h('button', { id: 'stopFocusBtn', class: 'action-btn danger', onclick: () => sendToWorker({ type: 'stopFocus' }) }, 'Stop Session')));
  } else if (f?.completed) {
    setChildren(box, h('p', { class: 'focus-result' }, `Last session finished: ${focusResultMessage(f.productiveSeconds || 0, f.duration)}`));
  } else if (f?.stopped) {
    setChildren(box, h('p', { class: 'focus-result' }, `Last session stopped after ${formatTime((f.stoppedAt - f.startTime) / 1000)}.`));
  } else {
    setChildren(box, h('p', {}, 'No focus session running.'));
  }
}

async function startFocus() {
  const minutes = Number($('focusMinutes').value);
  const result = await sendToWorker({ type: 'startFocus', minutes });
  if (!result?.ok) alert(result?.error || 'Could not start the focus session.');
}

function renderAchievements() {
  setChildren($('achievementsList'), generateAchievements(state.log, streak(), state.overrides).map(a =>
    h('div', { class: `achievement-item ${a.unlocked ? 'unlocked' : ''}` },
      h('div', { style: { fontSize: '1.5rem', marginBottom: '4px' } }, a.icon),
      h('div', { style: { fontSize: '0.75rem', fontWeight: '500' } }, a.name),
      h('div', { style: { fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' } }, a.description))));
}

function renderStreakChart() {
  const byDay = productiveSecondsByDay(state.log, state.overrides);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d); }
  const grid = h('div', { class: 'heatmap-grid' }, days.map((date, idx) => {
    const seconds = byDay[dayKey(date.getTime())] || 0;
    const minutes = seconds / 60;
    const level = minutes >= 120 ? 4 : minutes >= 60 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
    return h('div', { class: 'heatmap-col' },
      h('div', { class: `heatmap-day level-${level}${idx === 6 ? ' today' : ''}`, title: `${date.toLocaleDateString()}: ${formatTime(seconds)} productive` }),
      h('span', { class: 'heatmap-label' }, names[date.getDay()]));
  }));
  const legend = h('div', { class: 'heatmap-legend' }, h('span', {}, 'Less'),
    h('div', { class: 'heatmap-legend-squares' }, [0, 1, 2, 3, 4].map(l => h('div', { class: `heatmap-day level-${l}` }))),
    h('span', {}, 'More'));
  setChildren($('streakChart'), grid, legend);
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

function renderTheme() {
  const theme = state.settings.theme;
  const resolved = applyTheme(theme);
  $('themeToggle').textContent = resolved === 'light' ? '☀️' : '🌙';
  const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
  if (radio) radio.checked = true;
}

async function clearAllData() {
  if (!confirm('⚠️ This permanently deletes all activity, AI summaries, category changes and the focus session. Your settings and API keys are kept. Continue?')) return;
  await sendToWorker({ type: 'clearAllData' });
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function render() {
  renderTheme();
  if (state.tab === 'home') renderHome();
  if (state.tab === 'reports') renderReports();
  if (state.tab === 'goals') { renderFocus(); renderAchievements(); renderStreakChart(); }
}

function switchTab(name) {
  state.tab = name;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === name));
  render();
}

function setup() {
  document.querySelectorAll('.nav-tab').forEach(tab =>
    tab.addEventListener('click', e => switchTab(e.currentTarget.dataset.tab)));
  $('themeToggle').addEventListener('click', () =>
    storageSet({ theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light' }));
  $('summarizeBtn').addEventListener('click', summarizeCurrentPage);
  $('startGoalBtn').addEventListener('click', () => { switchTab('goals'); $('focusMinutes').focus(); });
  $('exportNotionBtn').addEventListener('click', exportTodayToNotion);
  $('dateRange').addEventListener('change', renderReports);
  $('startDate').addEventListener('change', renderReports);
  $('endDate').addEventListener('change', renderReports);
  $('downloadReportBtn').addEventListener('click', downloadReport);
  $('refreshReportBtn').addEventListener('click', async () => { await loadData(); renderReports(); });
  $('startFocusBtn').addEventListener('click', startFocus);
  $('exportDataBtn').addEventListener('click', exportDataFile);
  $('clearDataBtn').addEventListener('click', clearAllData);
  $('openOptionsBtn').addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  document.querySelectorAll('input[name="theme"]').forEach(radio =>
    radio.addEventListener('change', e => { if (e.target.checked) storageSet({ theme: e.target.value }); }));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTheme);

  // Re-render whenever the worker (or another page) changes stored data.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;
    await loadData();
    render();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  $('popupVersion').textContent = chrome.runtime.getManifest().version;
  setup();
  await loadData();
  const { start } = getDateRange('week');
  $('startDate').value = dayKey(start.getTime());
  $('endDate').value = dayKey(Date.now());
  render();
});
