// Main popup script for Digital Diary extension

class DigitalDiary {
  constructor() {
    this.currentTab = 'home';
    this.activityLog = [];
    this.summaries = [];
    this.streakData = { current: 0, longest: 0 };
    this.achievements = [];
    this.currentGoal = null;
    
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
        'theme'
      ]);
      
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
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.target.dataset.tab;
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
    // Update productivity score
    const score = Utils.calculateProductivityScore(this.activityLog);
    document.getElementById('productivityScore').textContent = score;

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
      summaryDiv.innerHTML = `
        <h3>Today's Activity</h3>
        <div class="loading">No activity recorded today. Start browsing!</div>
      `;
      return;
    }

    // Calculate category breakdown
    const categoryTime = {};
    const domainBreakdown = {};

    todayActivities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      domainBreakdown[entry.domain] = (domainBreakdown[entry.domain] || 0) + entry.timeSpent;
    });

    let html = `<h3>Today's Activity</h3>`;
    
    // Category breakdown
    html += `<div class="category-breakdown">`;
    Object.entries(categoryTime)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, seconds]) => {
        const minutes = Math.round(seconds / 60);
        if (minutes > 0) {
          html += `
            <div class="activity-item">
              <span class="activity-domain">${category}</span>
              <span class="activity-time">${Utils.formatTime(seconds)}</span>
            </div>
          `;
        }
      });
    html += `</div>`;

    // Top domains
    const topDomains = Object.entries(domainBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topDomains.length > 0) {
      html += `<h4 style="margin-top: 16px; margin-bottom: 8px;">Top Sites</h4>`;
      html += `<ul class="activity-list">`;
      topDomains.forEach(([domain, seconds]) => {
        const category = Utils.getCategoryForDomain(domain);
        html += `
          <li class="activity-item">
            <div>
              <span class="activity-domain">${domain}</span>
              <span class="category-tag category-${category.replace(' ', '-')}">${category}</span>
            </div>
            <span class="activity-time">${Utils.formatTime(seconds)}</span>
          </li>
        `;
      });
      html += `</ul>`;
    }

    // Recent summaries
    const todaySummaries = this.summaries.filter(summary => 
      new Date(summary.time).toDateString() === today
    ).slice(-2);

    if (todaySummaries.length > 0) {
      html += `<h4 style="margin-top: 16px; margin-bottom: 8px;">Key Takeaways</h4>`;
      todaySummaries.forEach(summary => {
        try {
          const hostname = new URL(summary.url).hostname;
          html += `
            <div class="summary-item" style="margin-bottom: 12px; padding: 8px; background: var(--bg-tertiary); border-radius: 6px;">
              <strong style="font-size: 0.875rem;">${hostname}</strong>
              <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: var(--text-secondary);">${summary.summary}</p>
            </div>
          `;
        } catch (e) {
          // Skip invalid URLs
        }
      });
    }

    summaryDiv.innerHTML = html;
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
      reportDiv.innerHTML = `<p>No activity data for the selected period.</p>`;
      return;
    }

    // Calculate statistics
    const totalTime = activities.reduce((sum, entry) => sum + entry.timeSpent, 0);
    const categoryTime = {};
    const dailyActivity = {};

    activities.forEach(entry => {
      const category = Utils.getCategoryForDomain(entry.domain);
      const date = new Date(entry.when).toDateString();
      
      categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
      
      if (!dailyActivity[date]) {
        dailyActivity[date] = 0;
      }
      dailyActivity[date] += entry.timeSpent;
    });

    let html = `
      <div class="report-summary">
        <h4>📊 ${period.charAt(0).toUpperCase() + period.slice(1)} Summary</h4>
        <p><strong>Total Time Tracked:</strong> ${Utils.formatTime(totalTime)}</p>
        <p><strong>Days Active:</strong> ${Object.keys(dailyActivity).length}</p>
        <p><strong>Average Daily Time:</strong> ${Utils.formatTime(totalTime / Math.max(1, Object.keys(dailyActivity).length))}</p>
      </div>
    `;

    // Category breakdown
    html += `<h4 style="margin-top: 20px;">📈 Time by Category</h4>`;
    html += `<ul class="activity-list">`;
    Object.entries(categoryTime)
      .sort((a, b) => b[1] - a[1])
      .forEach(([category, seconds]) => {
        const percentage = ((seconds / totalTime) * 100).toFixed(1);
        html += `
          <li class="activity-item">
            <div>
              <span class="activity-domain">${category}</span>
              <span class="category-tag category-${category.replace(' ', '-')}">${percentage}%</span>
            </div>
            <span class="activity-time">${Utils.formatTime(seconds)}</span>
          </li>
        `;
      });
    html += `</ul>`;

    // Daily breakdown
    if (Object.keys(dailyActivity).length > 1) {
      html += `<h4 style="margin-top: 20px;">📅 Daily Activity</h4>`;
      html += `<ul class="activity-list">`;
      Object.entries(dailyActivity)
        .sort((a, b) => new Date(b[0]) - new Date(a[0]))
        .slice(0, 7) // Show last 7 days
        .forEach(([date, seconds]) => {
          const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          html += `
            <li class="activity-item">
              <span class="activity-domain">${dayName}</span>
              <span class="activity-time">${Utils.formatTime(seconds)}</span>
            </li>
          `;
        });
      html += `</ul>`;
    }

    reportDiv.innerHTML = html;
  }

  renderGoals() {
    // Update current goal display
    const goalDisplay = document.getElementById('currentGoal');
    if (this.currentGoal && this.currentGoal.active) {
      const elapsed = Math.floor((Date.now() - this.currentGoal.startTime) / 1000);
      const remaining = Math.max(0, this.currentGoal.duration - elapsed);
      const progress = Math.min(100, (elapsed / this.currentGoal.duration) * 100);

      goalDisplay.innerHTML = `
        <div class="active-goal">
          <h5>🎯 ${this.currentGoal.type} Session</h5>
          <div class="goal-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progress}%"></div>
            </div>
            <p>${Utils.formatTime(remaining)} remaining</p>
          </div>
          <button id="stopGoalBtn" class="action-btn danger">Stop Session</button>
        </div>
      `;

      document.getElementById('stopGoalBtn').addEventListener('click', () => {
        this.stopGoal();
      });
    } else {
      goalDisplay.innerHTML = `<p>No active goal. Set one below!</p>`;
    }

    // Update achievements
    this.renderAchievements();

    // Update streak chart
    this.renderStreakChart();
  }

  renderAchievements() {
    const achievementsGrid = document.getElementById('achievementsList');
    
    let html = '';
    this.achievements.forEach(achievement => {
      const unlockedClass = achievement.unlocked ? 'unlocked' : '';
      html += `
        <div class="achievement-item ${unlockedClass}">
          <div style="font-size: 1.5rem; margin-bottom: 4px;">${achievement.icon}</div>
          <div style="font-size: 0.75rem; font-weight: 500;">${achievement.name}</div>
          <div style="font-size: 0.65rem; color: var(--text-muted); margin-top: 2px;">${achievement.description}</div>
        </div>
      `;
    });

    achievementsGrid.innerHTML = html;
  }

  renderStreakChart() {
    const chartDiv = document.getElementById('streakChart');
    
    // Simple streak visualization
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      days.push(date.toDateString());
    }

    let html = '<div style="display: flex; justify-content: space-between; align-items: end; height: 60px;">';
    
    days.forEach((day, index) => {
      const dayActivities = this.activityLog.filter(entry => 
        new Date(entry.when).toDateString() === day
      );
      
      const productiveTime = dayActivities
        .filter(entry => ['learning', 'productive'].includes(Utils.getCategoryForDomain(entry.domain)))
        .reduce((sum, entry) => sum + entry.timeSpent, 0);
      
      const isProductiveDay = productiveTime >= 1800; // 30 minutes
      const height = Math.max(10, Math.min(50, (productiveTime / 3600) * 40)); // Max 50px for 1+ hours
      
      html += `
        <div style="
          width: 12px; 
          height: ${height}px; 
          background: ${isProductiveDay ? 'var(--success)' : 'var(--bg-tertiary)'}; 
          border-radius: 2px;
          margin: 0 2px;
        " title="${new Date(day).toLocaleDateString()}: ${Utils.formatTime(productiveTime)}"></div>
      `;
    });
    
    html += '</div>';
    html += '<div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 0.7rem; color: var(--text-muted);">';
    html += '<span>7d ago</span><span>Today</span>';
    html += '</div>';

    chartDiv.innerHTML = html;
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
    if (this.currentGoal) {
      this.currentGoal.active = false;
      Utils.setStorageData({ currentGoal: this.currentGoal });
      this.renderGoals();
    }
  }

  completeGoal() {
    if (this.currentGoal && this.currentGoal.active) {
      this.currentGoal.active = false;
      this.currentGoal.completed = true;
      Utils.setStorageData({ currentGoal: this.currentGoal });
      
      // Show completion notification
      alert(`🎉 Goal completed! You finished your ${this.currentGoal.type} session.`);
      this.renderGoals();
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
      Utils.exportToJSON(data);
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