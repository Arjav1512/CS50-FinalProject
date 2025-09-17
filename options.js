// Options page script for Digital Diary extension

class OptionsPage {
  constructor() {
    this.settings = {};
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadStatistics();
    this.setupEventListeners();
    this.setupTheme();
    this.populateForm();
  }

  async loadSettings() {
    this.settings = await Utils.getStorageData([
      'notionApiKey',
      'notionDatabaseId', 
      'notionTemplate',
      'autoExportNotion',
      'minTrackingTime',
      'excludedDomains',
      'trackIncognito',
      'enableSummaries',
      'streakGoal',
      'enableNotifications',
      'enableGoalReminders',
      'dataRetention',
      'theme'
    ]);
  }

  async loadStatistics() {
    const data = await Utils.getStorageData(['activityLog', 'summaries']);
    const activityLog = data.activityLog || [];
    const summaries = data.summaries || [];

    // Calculate statistics
    const totalTime = activityLog.reduce((sum, entry) => sum + entry.timeSpent, 0);
    const uniqueDates = new Set(activityLog.map(entry => new Date(entry.when).toDateString()));
    const uniqueSites = new Set(activityLog.map(entry => entry.domain));
    const streakData = Utils.calculateStreak(activityLog);

    // Update statistics display
    document.getElementById('totalDays').textContent = uniqueDates.size;
    document.getElementById('totalTime').textContent = Utils.formatTime(totalTime);
    document.getElementById('totalSites').textContent = uniqueSites.size;
    document.getElementById('longestStreak').textContent = streakData.longest;
  }

  setupEventListeners() {
    // Notion settings
    document.getElementById('testNotionConnection').addEventListener('click', () => {
      this.testNotionConnection();
    });

    document.getElementById('saveNotionSettings').addEventListener('click', () => {
      this.saveNotionSettings();
    });

    // Data management
    document.getElementById('exportAllData').addEventListener('click', () => {
      this.exportAllData();
    });

    document.getElementById('clearOldData').addEventListener('click', () => {
      this.clearOldData();
    });

    document.getElementById('resetSettings').addEventListener('click', () => {
      this.resetSettings();
    });

    // About section
    document.getElementById('viewSource').addEventListener('click', () => {
      window.open('https://github.com/yourusername/digital-diary', '_blank');
    });

    document.getElementById('reportIssue').addEventListener('click', () => {
      window.open('https://github.com/yourusername/digital-diary/issues', '_blank');
    });

    // Auto-save settings on change
    this.setupAutoSave();
  }

  setupAutoSave() {
    const inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(input => {
      input.addEventListener('change', Utils.debounce(() => {
        this.saveAllSettings();
      }, 1000));
    });
  }

  async setupTheme() {
    const theme = await Utils.getTheme();
    Utils.setTheme(theme);
  }

  populateForm() {
    // Notion settings
    if (this.settings.notionApiKey) {
      document.getElementById('notionApiKey').value = this.settings.notionApiKey;
    }
    if (this.settings.notionDatabaseId) {
      document.getElementById('notionDatabaseId').value = this.settings.notionDatabaseId;
    }
    if (this.settings.notionTemplate) {
      document.getElementById('notionTemplate').value = this.settings.notionTemplate;
    }
    document.getElementById('autoExportNotion').checked = this.settings.autoExportNotion || false;

    // Tracking preferences
    document.getElementById('minTrackingTime').value = this.settings.minTrackingTime || 5;
    if (this.settings.excludedDomains) {
      document.getElementById('excludedDomains').value = this.settings.excludedDomains.join('\n');
    }
    document.getElementById('trackIncognito').checked = this.settings.trackIncognito || false;
    document.getElementById('enableSummaries').checked = this.settings.enableSummaries !== false;

    // Gamification
    document.getElementById('streakGoal').value = this.settings.streakGoal || 30;
    document.getElementById('enableNotifications').checked = this.settings.enableNotifications !== false;
    document.getElementById('enableGoalReminders').checked = this.settings.enableGoalReminders || false;

    // Data retention
    document.getElementById('dataRetention').value = this.settings.dataRetention || 90;
  }

  async testNotionConnection() {
    const apiKey = document.getElementById('notionApiKey').value;
    const databaseId = document.getElementById('notionDatabaseId').value;

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
        const data = await response.json();
        this.showStatus('success', `✅ Connected to "${data.title[0]?.plain_text || 'Untitled'}" database!`);
      } else {
        const error = await response.json();
        throw new Error(error.message || 'Connection failed');
      }
    } catch (error) {
      console.error('Notion connection error:', error);
      this.showStatus('error', `❌ Connection failed: ${error.message}`);
    }
  }

  async saveNotionSettings() {
    const settings = {
      notionApiKey: document.getElementById('notionApiKey').value,
      notionDatabaseId: document.getElementById('notionDatabaseId').value,
      notionTemplate: document.getElementById('notionTemplate').value,
      autoExportNotion: document.getElementById('autoExportNotion').checked
    };

    await Utils.setStorageData(settings);
    this.showStatus('success', '✅ Notion settings saved!');
  }

  async saveAllSettings() {
    const excludedDomainsText = document.getElementById('excludedDomains').value;
    const excludedDomains = excludedDomainsText
      .split('\n')
      .map(domain => domain.trim())
      .filter(domain => domain.length > 0);

    const settings = {
      notionApiKey: document.getElementById('notionApiKey').value,
      notionDatabaseId: document.getElementById('notionDatabaseId').value,
      notionTemplate: document.getElementById('notionTemplate').value,
      autoExportNotion: document.getElementById('autoExportNotion').checked,
      minTrackingTime: parseInt(document.getElementById('minTrackingTime').value) || 5,
      excludedDomains: excludedDomains,
      trackIncognito: document.getElementById('trackIncognito').checked,
      enableSummaries: document.getElementById('enableSummaries').checked,
      streakGoal: parseInt(document.getElementById('streakGoal').value) || 30,
      enableNotifications: document.getElementById('enableNotifications').checked,
      enableGoalReminders: document.getElementById('enableGoalReminders').checked,
      dataRetention: parseInt(document.getElementById('dataRetention').value) || 90
    };

    await Utils.setStorageData(settings);
    console.log('Settings auto-saved');
  }

  showStatus(type, message) {
    const statusDiv = document.getElementById('notionStatus');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
    
    setTimeout(() => {
      statusDiv.className = 'status-message';
      statusDiv.textContent = '';
    }, 5000);
  }

  async exportAllData() {
    const data = await Utils.getStorageData(null);
    Utils.exportToJSON(data);
    alert('📤 All data exported successfully!');
  }

  async clearOldData() {
    const retentionDays = parseInt(document.getElementById('dataRetention').value);
    
    if (retentionDays === 0) {
      alert('Data retention is set to "Keep forever". No data will be cleared.');
      return;
    }

    if (!confirm(`This will delete activity data older than ${retentionDays} days. Continue?`)) {
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const data = await Utils.getStorageData(['activityLog', 'summaries']);
    const activityLog = data.activityLog || [];
    const summaries = data.summaries || [];

    const filteredActivities = activityLog.filter(entry => 
      new Date(entry.when) >= cutoffDate
    );

    const filteredSummaries = summaries.filter(entry => 
      new Date(entry.time) >= cutoffDate
    );

    await Utils.setStorageData({
      activityLog: filteredActivities,
      summaries: filteredSummaries
    });

    const deletedActivities = activityLog.length - filteredActivities.length;
    const deletedSummaries = summaries.length - filteredSummaries.length;

    alert(`🧹 Cleanup complete!\nDeleted ${deletedActivities} activity entries and ${deletedSummaries} summaries.`);
    
    // Refresh statistics
    await this.loadStatistics();
  }

  async resetSettings() {
    if (!confirm('⚠️ This will reset all settings to defaults. Your activity data will be preserved. Continue?')) {
      return;
    }

    // Clear only settings, preserve activity data
    const dataToKeep = await Utils.getStorageData(['activityLog', 'summaries']);
    
    chrome.storage.local.clear(async () => {
      // Restore activity data
      await Utils.setStorageData(dataToKeep);
      
      alert('🔄 Settings reset to defaults!');
      location.reload();
    });
  }
}

// Initialize options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new OptionsPage();
});