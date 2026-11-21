import { Utils } from './utils.js';
import { withoutSecrets } from './lib/core.js';
import { h, setChildren, sendToWorker } from './lib/ui.js';
import { CATEGORY_COLORS } from './lib/core.js';

// Bars for a { category: seconds } map.
function categoryBars(categoryTime, total, showPercent) {
  return h('div', { class: 'category-breakdown' }, Object.entries(categoryTime)
    .sort((a, b) => b[1] - a[1])
    .filter(([, seconds]) => showPercent || Math.round(seconds / 60) > 0)
    .map(([category, seconds]) => {
      const pct = Math.round((seconds / Math.max(1, total)) * 100);
      return h('div', { class: 'category-bar-row' },
        h('div', { class: 'category-bar-header' },
          h('span', { class: 'activity-domain' }, category),
          h('span', { class: 'activity-time' }, showPercent ? `${Utils.formatTime(seconds)} · ${pct}%` : Utils.formatTime(seconds))),
        h('div', { class: 'category-bar-track' },
          h('div', { class: 'category-bar-fill', style: { width: `${pct}%`, background: CATEGORY_COLORS[category] || 'var(--text-muted)' } })));
    }));
}

// A stored AI summary (text that came from a web page via Gemini) — text only.
function summaryCard(item) {
  let label = item.title || '';
  try { label = label || new URL(item.url).hostname; } catch { /* keep title */ }
  return h('div', { class: 'summary-item' },
    h('strong', {}, label),
    h('p', {}, item.summary));
}

// Main popup script for Digital Diary extension

class DigitalDiary {
  constructor() {
    this.currentTab = 'home';
    this.activityLog = [];
    this.summaries = [];
    this.streakData = { current: 0, longest: 0 };
    this.achievements = [];
    this.currentGoal = null;
    this.goalCountdownInterval = null;

    this.init();
  }

  async init() {
    await this.loadData();
    this.setupEventListeners();
    this.setupTheme();
    this.renderCurrentTab();
    this.startPeriodicUpdates();
  }

  async loadData() {
    try {
      const data = await Utils.getStorageData([
        'activityLog', 
        'summaries', 
        'streakData', 
        'achievements', 
        'currentGoal',
        'theme',
        'categoryOverrides',
        'streakGoal'
      ]);
      Utils.setContext({ overrides: data.categoryOverrides || {}, goalMinutes: data.streakGoal || 30 });
      
      this.activityLog = data.activityLog || [];
      this.summaries = data.summaries || [];
      this.streakData = Utils.calculateStreak(this.activityLog);
      this.achievements = Utils.generateAchievements(this.activityLog, this.streakData);
      this.currentGoal = data.currentGoal || null;
      
      console.log('Data loaded:', {
        activities: this.activityLog.length,
        summaries: this.summaries.length,
        streak: this.streakData
      });
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  setupEventListeners() {
    // Tab navigation — use currentTarget so SVG children don't break the lookup
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => {
      this.toggleTheme();
    });

    // Home tab actions
    document.getElementById('startGoalBtn').addEventListener('click', () => {
      this.switchTab('goals');
    });

    document.getElementById('summarizeBtn').addEventListener('click', () => {
      this.summarizeCurrentPage();
    });

    document.getElementById('exportNotionBtn').addEventListener('click', () => {
      this.exportToNotion();
    });

    // Reports tab
    document.getElementById('dateRange').addEventListener('change', (e) => {
      this.handleDateRangeChange(e.target.value);
    });

    document.getElementById('generatePdfBtn').addEventListener('click', () => {
      this.generatePDF();
    });

    document.getElementById('refreshReportBtn').addEventListener('click', () => {
      this.refreshReport();
    });

    // Goals tab
    document.getElementById('setGoalBtn').addEventListener('click', () => {
      this.setGoal();
    });

    // Settings tab
    document.getElementById('testNotionBtn').addEventListener('click', () => {
      this.testNotionConnection();
    });

    document.getElementById('saveNotionBtn').addEventListener('click', () => {
      this.saveNotionSettings();
    });

    document.getElementById('exportDataBtn').addEventListener('click', () => {
      this.exportAllData();
    });

    document.getElementById('clearDataBtn').addEventListener('click', () => {
      this.clearAllData();
    });

    document.getElementById('openOptionsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Theme radio buttons
    document.querySelectorAll('input[name="theme"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          Utils.setTheme(e.target.value);
        }
      });
    });
  }

  async setupTheme() {
    const theme = await Utils.getTheme();
    Utils.setTheme(theme);
    
    // Update theme toggle button
    const themeBtn = document.getElementById('themeToggle');
    themeBtn.textContent = theme === 'light' ? '☀️' : '🌙';
    
    // Update radio buttons
    document.querySelector(`input[name="theme"][value="${theme}"]`).checked = true;
  }

  switchTab(tabName) {
    // Update navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content
    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    this.currentTab = tabName;
    this.renderCurrentTab();
  }

  renderCurrentTab() {
    switch (this.currentTab) {
      case 'home':
        this.renderHome();
        break;
      case 'reports':
        this.renderReports();
        break;
      case 'goals':
        this.renderGoals();
        break;
      case 'settings':
        this.renderSettings();
        break;
    }
  }

  renderHome() {
    const score = Utils.calculateProductivityScore(this.activityLog);
    document.getElementById('productivityScore').textContent = score;

    // Animate SVG ring (circumference of r=52 circle ≈ 326.73)
    const ring = document.getElementById('scoreRingFill');
    if (ring) {
      const circumference = 326.73;
      ring.style.strokeDashoffset = circumference - (score / 100) * circumference;
    }

    // Update streak display
    document.getElementById('currentStreak').textContent = this.streakData.current;
    const progressPercent = Math.min(100, (this.streakData.current / 7) * 100);
    document.getElementById('streakProgress').style.width = `${progressPercent}%`;

    // Update today's summary
    this.renderTodaySummary();
  }

  renderTodaySummary() {
    const today = new Date().toDateString();
    const todayActivities = this.activityLog.filter(entry =>
      new Date(entry.when).toDateString() === today
    );
    const summaryDiv = document.getElementById('todayReport');

    if (todayActivities.length === 0) {
      setChildren(summaryDiv,
        h('h3', {}, "Today's Activity"),
        h('div', { class: 'loading' }, 'No activity recorded today. Start browsing!'));
      return;
    }

    const categoryTime = {};
    const domainBreakdown = {};
    todayActivities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      domainBreakdown[entry.domain] = (domainBreakdown[entry.domain] || 0) + entry.timeSpent;
    });
    const totalCatTime = Object.values(categoryTime).reduce((a, b) => a + b, 0);

    const nodes = [h('h3', {}, "Today's Activity"), categoryBars(categoryTime, totalCatTime, false)];

    const topDomains = Object.entries(domainBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topDomains.length > 0) {
      nodes.push(h('h4', { style: { marginTop: '16px', marginBottom: '8px' } }, 'Top Sites'));
      nodes.push(h('ul', { class: 'activity-list' }, topDomains.map(([domain, seconds]) => {
        const category = Utils.getCategoryForDomain(domain);
        return h('li', { class: 'activity-item' },
          h('div', {},
            h('span', { class: 'activity-domain' }, domain),
            h('span', { class: `category-tag category-${category.replace(' ', '-')}` }, category)),
          h('span', { class: 'activity-time' }, Utils.formatTime(seconds)));
      })));
    }

    const todaySummaries = this.summaries.filter(s => new Date(s.time).toDateString() === today).slice(-2);
    if (todaySummaries.length > 0) {
      nodes.push(h('h4', { style: { marginTop: '16px', marginBottom: '8px' } }, 'Key Takeaways'));
      todaySummaries.forEach(item => nodes.push(summaryCard(item)));
    }
    setChildren(summaryDiv, nodes);
  }

  renderReports() {
    const dateRange = document.getElementById('dateRange').value;
    const { start, end } = Utils.getDateRange(dateRange);
    const filteredActivities = this.activityLog.filter(entry => {
      const entryDate = new Date(entry.when);
      return entryDate >= start && entryDate <= end;
    });
    this.renderReportContent(filteredActivities, dateRange);
  }

  renderReportContent(activities, period) {
    const reportDiv = document.getElementById('reportContent');
    if (activities.length === 0) {
      setChildren(reportDiv, h('p', {}, 'No activity data for the selected period.'));
      return;
    }
    const totalTime = activities.reduce((sum, entry) => sum + entry.timeSpent, 0);
    const categoryTime = {};
    const dailyActivity = {};
    activities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      const date = new Date(entry.when).toDateString();
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      dailyActivity[date] = (dailyActivity[date] || 0) + entry.timeSpent;
    });
    const days = Object.keys(dailyActivity).length;

    const nodes = [
      h('div', { class: 'report-summary' },
        h('h4', {}, `${period.charAt(0).toUpperCase() + period.slice(1)} Summary`),
        h('p', {}, h('strong', {}, 'Total Time Tracked:'), ` ${Utils.formatTime(totalTime)}`),
        h('p', {}, h('strong', {}, 'Days Active:'), ` ${days}`),
        h('p', {}, h('strong', {}, 'Average Daily Time:'), ` ${Utils.formatTime(totalTime / Math.max(1, days))}`)),
      h('h4', { style: { marginTop: '20px' } }, 'Time by Category'),
      categoryBars(categoryTime, totalTime, true)
    ];

    if (days > 1) {
      nodes.push(h('h4', { style: { marginTop: '20px' } }, 'Daily Activity'));
      nodes.push(h('ul', { class: 'activity-list' },
        Object.entries(dailyActivity)
          .sort((a, b) => new Date(b[0]) - new Date(a[0]))
          .slice(0, 7)
          .map(([date, seconds]) => h('li', { class: 'activity-item' },
            h('span', { class: 'activity-domain' }, new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })),
            h('span', { class: 'activity-time' }, Utils.formatTime(seconds))))));
    }
    setChildren(reportDiv, nodes);
  }

  renderGoals() {
    if (this.goalCountdownInterval) {
      clearInterval(this.goalCountdownInterval);
      this.goalCountdownInterval = null;
    }
    const goalDisplay = document.getElementById('currentGoal');
    if (this.currentGoal && this.currentGoal.active) {
      const elapsed = Math.floor((Date.now() - this.currentGoal.startTime) / 1000);
      const remaining = Math.max(0, this.currentGoal.duration - elapsed);
      const progress = Math.min(100, (elapsed / this.currentGoal.duration) * 100);
      const fill = h('div', { class: 'progress-fill', style: { width: `${progress}%` } });
      const remainingText = h('p', {}, `${Utils.formatTime(remaining)} remaining`);
      setChildren(goalDisplay, h('div', { class: 'active-goal' },
        h('h5', {}, `${this.currentGoal.type} Session`),
        h('div', { class: 'goal-progress' }, h('div', { class: 'progress-bar' }, fill), remainingText),
        h('button', { class: 'action-btn danger', onclick: () => this.stopGoal() }, 'Stop Session')));

      this.goalCountdownInterval = setInterval(() => {
        const el = Math.floor((Date.now() - this.currentGoal.startTime) / 1000);
        const rem = Math.max(0, this.currentGoal.duration - el);
        remainingText.textContent = `${Utils.formatTime(rem)} remaining`;
        fill.style.width = `${Math.min(100, (el / this.currentGoal.duration) * 100)}%`;
        if (rem === 0) {
          clearInterval(this.goalCountdownInterval);
          this.goalCountdownInterval = null;
          this.completeGoal();
        }
      }, 1000);
    } else {
      setChildren(goalDisplay, h('p', {}, 'No active goal. Set one below!'));
    }
    this.renderAchievements();
    this.renderStreakChart();
  }

  renderAchievements() {
    setChildren(document.getElementById('achievementsList'), this.achievements.map(a =>
      h('div', { class: `achievement-item ${a.unlocked ? 'unlocked' : ''}` },
        h('div', { style: { fontSize: '1.5rem', marginBottom: '4px' } }, a.icon),
        h('div', { style: { fontSize: '0.75rem', fontWeight: '500' } }, a.name),
        h('div', { style: { fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' } }, a.description))));
  }

  renderStreakChart() {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const grid = h('div', { class: 'heatmap-grid' }, days.map((date, idx) => {
      const dateStr = date.toDateString();
      const productiveTime = this.activityLog
        .filter(entry => new Date(entry.when).toDateString() === dateStr)
        .filter(entry => ['learning', 'productive'].includes(Utils.getCategoryForDomain(entry.domain)))
        .reduce((sum, entry) => sum + entry.timeSpent, 0);
      const minutes = productiveTime / 60;
      const level = minutes >= 120 ? 4 : minutes >= 60 ? 3 : minutes >= 30 ? 2 : minutes > 0 ? 1 : 0;
      return h('div', { class: 'heatmap-col' },
        h('div', { class: `heatmap-day level-${level}${idx === 6 ? ' today' : ''}`, title: `${date.toLocaleDateString()}: ${Utils.formatTime(productiveTime)} productive` }),
        h('span', { class: 'heatmap-label' }, dayNames[date.getDay()]));
    }));
    const legend = h('div', { class: 'heatmap-legend' },
      h('span', {}, 'Less'),
      h('div', { class: 'heatmap-legend-squares' }, [0, 1, 2, 3, 4].map(l => h('div', { class: `heatmap-day level-${l}` }))),
      h('span', {}, 'More'));
    setChildren(document.getElementById('streakChart'), grid, legend);
  }

  renderSettings() {
    // Load saved Notion settings
    Utils.getStorageData(['notionApiKey', 'notionDatabaseId']).then(data => {
      if (data.notionApiKey) {
        document.getElementById('notionApiKey').value = data.notionApiKey;
      }
      if (data.notionDatabaseId) {
        document.getElementById('notionDatabaseId').value = data.notionDatabaseId;
      }
    });
  }

  // Event handlers
  handleDateRangeChange(value) {
    const customRange = document.getElementById('customDateRange');
    if (value === 'custom') {
      customRange.classList.remove('hidden');
    } else {
      customRange.classList.add('hidden');
      this.renderReports();
    }
  }

  async toggleTheme() {
    const currentTheme = await Utils.getTheme();
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    Utils.setTheme(newTheme);
    
    const themeBtn = document.getElementById('themeToggle');
    themeBtn.textContent = newTheme === 'light' ? '☀️' : '🌙';
    
    document.querySelector(`input[name="theme"][value="${newTheme}"]`).checked = true;
  }

  setGoal() {
    const type = document.getElementById('goalType').value;
    const duration = parseInt(document.getElementById('goalDuration').value) * 60; // Convert to seconds

    if (!duration || duration < 300) { // Minimum 5 minutes
      alert('Please set a goal duration of at least 5 minutes.');
      return;
    }

    this.currentGoal = {
      type: type,
      duration: duration,
      startTime: Date.now(),
      active: true
    };

    Utils.setStorageData({ currentGoal: this.currentGoal });
    this.renderGoals();

    // Set up goal completion check
    setTimeout(() => {
      if (this.currentGoal && this.currentGoal.active) {
        this.completeGoal();
      }
    }, duration * 1000);
  }

  stopGoal() {
    if (this.goalCountdownInterval) {
      clearInterval(this.goalCountdownInterval);
      this.goalCountdownInterval = null;
    }
    if (this.currentGoal) {
      this.currentGoal.active = false;
      Utils.setStorageData({ currentGoal: this.currentGoal });
      this.renderGoals();
    }
  }

  completeGoal() {
    if (this.goalCountdownInterval) {
      clearInterval(this.goalCountdownInterval);
      this.goalCountdownInterval = null;
    }
    if (this.currentGoal && this.currentGoal.active) {
      this.currentGoal.active = false;
      this.currentGoal.completed = true;
      Utils.setStorageData({ currentGoal: this.currentGoal });
      alert(`🎉 Goal completed! You finished your ${this.currentGoal.type} session.`);
      this.renderGoals();
    }
  }

  // Reads ONLY the current tab, ONLY now (activeTab + scripting, in the worker).
  async summarizeCurrentPage() {
    const button = document.getElementById('summarizeBtn');
    const out = document.getElementById('summaryResult');
    button.disabled = true;
    setChildren(out, h('div', { class: 'loading' }, 'Summarizing…'));
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const result = tab ? await sendToWorker({ type: 'summarizePage', tabId: tab.id }) : { ok: false, error: 'No active tab.' };
      if (result && result.ok) {
        setChildren(out, summaryCard(result));
        await this.loadData();
      } else {
        setChildren(out, h('div', { class: 'status-message error' }, (result && result.error) || 'Could not summarize this page.'));
      }
    } catch (err) {
      setChildren(out, h('div', { class: 'status-message error' }, err.message));
    } finally {
      button.disabled = false;
    }
  }

  async exportToNotion() {
    const settings = await Utils.getStorageData(['notionApiKey', 'notionDatabaseId']);
    
    if (!settings.notionApiKey || !settings.notionDatabaseId) {
      alert('Please configure Notion settings first in the Settings tab.');
      this.switchTab('settings');
      return;
    }

    try {
      const today = new Date().toDateString();
      const todayActivities = this.activityLog.filter(entry => 
        new Date(entry.when).toDateString() === today
      );

      const summary = this.generateDailySummary(todayActivities);
      
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.notionApiKey}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
          parent: { database_id: settings.notionDatabaseId },
          properties: {
            'Title': {
              title: [{ text: { content: `Digital Diary - ${new Date().toLocaleDateString()}` } }]
            },
            'Date': {
              date: { start: new Date().toISOString().split('T')[0] }
            },
            'Productivity Score': {
              number: Utils.calculateProductivityScore(todayActivities)
            }
          },
          children: [{
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: summary } }]
            }
          }]
        })
      });

      if (response.ok) {
        alert('✅ Successfully exported to Notion!');
      } else {
        throw new Error('Failed to export to Notion');
      }
    } catch (error) {
      console.error('Notion export error:', error);
      alert('❌ Failed to export to Notion. Please check your settings.');
    }
  }

  generateDailySummary(activities) {
    if (activities.length === 0) {
      return 'No activity recorded today.';
    }

    const categoryTime = {};
    let totalTime = 0;

    activities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      totalTime += entry.timeSpent;
    });

    let summary = `Daily Digital Activity Summary\n\n`;
    summary += `Total Time Tracked: ${Utils.formatTime(totalTime)}\n`;
    summary += `Productivity Score: ${Utils.calculateProductivityScore(activities)}/100\n\n`;
    
    summary += `Time by Category:\n`;
    Object.entries(categoryTime)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, seconds]) => {
        const percentage = ((seconds / totalTime) * 100).toFixed(1);
        summary += `• ${category}: ${Utils.formatTime(seconds)} (${percentage}%)\n`;
      });

    // Add recent summaries
    const today = new Date().toDateString();
    const todaySummaries = this.summaries.filter(summary => 
      new Date(summary.time).toDateString() === today
    );

    if (todaySummaries.length > 0) {
      summary += `\nKey Takeaways:\n`;
      todaySummaries.slice(-3).forEach(item => {
        try {
          const hostname = new URL(item.url).hostname;
          summary += `• ${hostname}: ${item.summary}\n`;
        } catch (e) {
          // Skip invalid URLs
        }
      });
    }

    return summary;
  }

  async generatePDF() {
    // For now, we'll create a simple text-based report
    // In a full implementation, you'd use a library like jsPDF
    const dateRange = document.getElementById('dateRange').value;
    const { start, end } = Utils.getDateRange(dateRange);
    
    const filteredActivities = this.activityLog.filter(entry => {
      const entryDate = new Date(entry.when);
      return entryDate >= start && entryDate <= end;
    });

    const reportContent = this.generateTextReport(filteredActivities, dateRange);
    
    // Create and download as text file (placeholder for PDF)
    const blob = new Blob([reportContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-diary-report-${dateRange}-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    alert('📄 Report downloaded! (Note: PDF generation will be implemented in future version)');
  }

  generateTextReport(activities, period) {
    let report = `DIGITAL DIARY REPORT\n`;
    report += `Period: ${period.charAt(0).toUpperCase() + period.slice(1)}\n`;
    report += `Generated: ${new Date().toLocaleString()}\n`;
    report += `${'='.repeat(50)}\n\n`;

    if (activities.length === 0) {
      report += `No activity data for the selected period.\n`;
      return report;
    }

    // Summary statistics
    const totalTime = activities.reduce((sum, entry) => sum + entry.timeSpent, 0);
    const categoryTime = {};
    const domainTime = {};

    activities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      domainTime[entry.domain] = (domainTime[entry.domain] || 0) + entry.timeSpent;
    });

    report += `SUMMARY\n`;
    report += `${'─'.repeat(20)}\n`;
    report += `Total Time Tracked: ${Utils.formatTime(totalTime)}\n`;
    report += `Productivity Score: ${Utils.calculateProductivityScore(activities)}/100\n`;
    report += `Unique Domains: ${Object.keys(domainTime).length}\n\n`;

    // Category breakdown
    report += `TIME BY CATEGORY\n`;
    report += `${'─'.repeat(20)}\n`;
    Object.entries(categoryTime)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, seconds]) => {
        const percentage = ((seconds / totalTime) * 100).toFixed(1);
        report += `${category.padEnd(15)} ${Utils.formatTime(seconds).padStart(8)} (${percentage}%)\n`;
      });

    report += `\n`;

    // Top domains
    report += `TOP DOMAINS\n`;
    report += `${'─'.repeat(20)}\n`;
    Object.entries(domainTime)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([domain, seconds]) => {
        const category = Utils.getCategoryForDomain(domain);
        report += `${domain.padEnd(25)} ${Utils.formatTime(seconds).padStart(8)} [${category}]\n`;
      });

    return report;
  }

  async testNotionConnection() {
    const apiKey = document.getElementById('notionApiKey').value;
    const databaseId = document.getElementById('notionDatabaseId').value;
    const statusDiv = document.getElementById('notionStatus');

    if (!apiKey || !databaseId) {
      this.showStatus('error', 'Please enter both API key and Database ID.');
      return;
    }

    try {
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28'
        }
      });

      if (response.ok) {
        this.showStatus('success', '✅ Connection successful!');
      } else {
        throw new Error('Connection failed');
      }
    } catch (error) {
      this.showStatus('error', '❌ Connection failed. Please check your credentials.');
    }
  }

  async saveNotionSettings() {
    const apiKey = document.getElementById('notionApiKey').value;
    const databaseId = document.getElementById('notionDatabaseId').value;

    if (!apiKey || !databaseId) {
      this.showStatus('error', 'Please enter both API key and Database ID.');
      return;
    }

    await Utils.setStorageData({
      notionApiKey: apiKey,
      notionDatabaseId: databaseId
    });

    this.showStatus('success', '✅ Settings saved successfully!');
  }

  showStatus(type, message) {
    const statusDiv = document.getElementById('notionStatus');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
    
    setTimeout(() => {
      statusDiv.className = 'status-message';
      statusDiv.textContent = '';
    }, 3000);
  }

  exportAllData() {
    Utils.getStorageData(null).then(data => {
      Utils.exportToJSON(withoutSecrets(data));
      alert('📤 All data exported successfully!');
    });
  }

  clearAllData() {
    if (confirm('⚠️ This will permanently delete all your activity data. Are you sure?')) {
      chrome.storage.local.clear(() => {
        alert('🗑️ All data cleared successfully!');
        location.reload();
      });
    }
  }

  refreshReport() {
    this.loadData().then(() => {
      this.renderReports();
      alert('🔄 Report refreshed!');
    });
  }

  startPeriodicUpdates() {
    // Update data every 30 seconds when popup is open
    setInterval(() => {
      this.loadData().then(() => {
        if (this.currentTab === 'home') {
          this.renderHome();
        }
      });
    }, 30000);
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new DigitalDiary();
});
