// Digital Diary options page. Every field saves automatically on change.

import { DEFAULT_SETTINGS, withDefaults, formatTime, calculateStreak, totalSeconds, secondsByDay, readableEntries } from './lib/core.js';
import { applyTheme, debounce, storageGet, storageSet, sendToWorker, showStatus as showStatusIn, exportDataFile } from './lib/ui.js';
import { getDatabase, databaseTitle, normalizeDatabaseId } from './lib/notion.js';

const $ = id => document.getElementById(id);
const clampInt = (value, min, max, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const setStatus = (id, type, message, ms) => showStatusIn($(id), type, message, ms);

// Reads the form into a settings object (validated).
function readForm() {
  return {
    notionApiKey: $('notionApiKey').value.trim(),
    notionDatabaseId: $('notionDatabaseId').value.trim(),
    enableSummaries: $('enableSummaries').checked,
    geminiApiKey: $('geminiApiKey').value.trim(),
    minTrackingTime: clampInt($('minTrackingTime').value, 1, 60, DEFAULT_SETTINGS.minTrackingTime),
    excludedDomains: $('excludedDomains').value.split('\n').map(d => d.trim()).filter(Boolean),
    streakGoal: clampInt($('streakGoal').value, 5, 480, DEFAULT_SETTINGS.streakGoal),
    enableNotifications: $('enableNotifications').checked,
    dataRetention: clampInt($('dataRetention').value, 0, 3650, DEFAULT_SETTINGS.dataRetention)
  };
}

function fillForm(settings) {
  $('notionApiKey').value = settings.notionApiKey;
  $('notionDatabaseId').value = settings.notionDatabaseId;
  $('enableSummaries').checked = settings.enableSummaries === true;
  $('geminiApiKey').value = settings.geminiApiKey;
  $('minTrackingTime').value = settings.minTrackingTime;
  $('excludedDomains').value = (settings.excludedDomains || []).join('\n');
  $('streakGoal').value = settings.streakGoal;
  $('enableNotifications').checked = settings.enableNotifications !== false;
  $('dataRetention').value = String(settings.dataRetention);
}

async function loadSettings() {
  return withDefaults(await storageGet(Object.keys(DEFAULT_SETTINGS)));
}

async function saveAll() {
  const settings = readForm();
  await storageSet(settings);
  fillForm({ ...(await loadSettings()), ...settings }); // show clamped values
  setStatus('saveStatus', 'success', 'Saved', 1500);
}

async function renderStatistics() {
  const data = await storageGet(['activityLog', 'categoryOverrides', 'streakGoal']);
  const log = readableEntries(data.activityLog);   // same entries as reports/streaks
  $('totalDays').textContent = Object.keys(secondsByDay(log)).length;
  $('totalTime').textContent = formatTime(totalSeconds(log));
  $('totalSites').textContent = new Set(log.map(e => e.domain)).size;
  $('longestStreak').textContent = calculateStreak(log, { goalMinutes: data.streakGoal || DEFAULT_SETTINGS.streakGoal, overrides: data.categoryOverrides || {} }).longest;
}

async function testNotion() {
  const apiKey = $('notionApiKey').value.trim();
  const databaseId = $('notionDatabaseId').value.trim();
  if (!apiKey || !normalizeDatabaseId(databaseId)) {
    setStatus('notionStatus', 'error', 'Enter your Notion API key and a valid database ID.');
    return;
  }
  setStatus('notionStatus', 'success', 'Connecting…', 0);
  try {
    const db = await getDatabase(fetch, apiKey, databaseId);
    setStatus('notionStatus', 'success', `✅ Connected to "${databaseTitle(db)}".`, 6000);
  } catch (err) {
    setStatus('notionStatus', 'error', `❌ Connection failed: ${err.message}`, 8000);
  }
}

async function saveNotion() {
  await storageSet({ notionApiKey: $('notionApiKey').value.trim(), notionDatabaseId: $('notionDatabaseId').value.trim() });
  setStatus('notionStatus', 'success', '✅ Notion settings saved.');
}

async function exportData() {
  await exportDataFile();
  setStatus('dataStatus', 'success', 'Exported (API keys are not included).');
}

async function clearOldData() {
  await saveAll(); // use the retention period currently selected
  const days = Number($('dataRetention').value);
  if (days === 0) {
    setStatus('dataStatus', 'error', 'Retention is set to "Keep forever", so nothing was deleted.', 6000);
    return;
  }
  if (!confirm(`Delete activity and AI summaries older than ${days} days?`)) return;
  const result = await sendToWorker({ type: 'clearOldData' });
  setStatus('dataStatus', 'success', `Deleted ${result.removedActivities} visits and ${result.removedSummaries} summaries.`, 6000);
  await renderStatistics();
}

async function resetSettings() {
  if (!confirm('Reset all settings (including API keys) to defaults? Your activity data and the data-retention period are kept.')) return;
  await sendToWorker({ type: 'resetSettings' });
  fillForm(await loadSettings());
  setStatus('dataStatus', 'success', 'Settings reset to defaults.');
}

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await loadSettings();
  applyTheme(settings.theme);
  fillForm(settings);
  $('version').textContent = chrome.runtime.getManifest().version;
  await renderStatistics();

  const autoSave = debounce(saveAll, 400);
  document.querySelectorAll('input, select, textarea').forEach(el => el.addEventListener('change', autoSave));
  $('testNotionConnection').addEventListener('click', testNotion);
  $('saveNotionSettings').addEventListener('click', saveNotion);
  $('exportAllData').addEventListener('click', exportData);
  $('clearOldData').addEventListener('click', clearOldData);
  $('resetSettings').addEventListener('click', resetSettings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue || DEFAULT_SETTINGS.theme);
  });
});
