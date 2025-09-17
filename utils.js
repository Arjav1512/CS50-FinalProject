// Utility functions for the Digital Diary extension

class Utils {
  // Format time in seconds to human readable format
  static formatTime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  // Calculate productivity score based on activity
  static calculateProductivityScore(activityLog) {
    if (!activityLog || activityLog.length === 0) return 0;

    const categories = {
      "learning": 10,
      "productive": 8,
      "shopping": 3,
      "entertainment": 2,
      "social media": 1,
      "doomscrolling": 0
    };

    let totalTime = 0;
    let weightedScore = 0;

    activityLog.forEach(entry => {
      const category = this.getCategoryForDomain(entry.domain);
      const weight = categories[category] || 5; // Default weight for unknown categories
      const time = entry.timeSpent;
      
      totalTime += time;
      weightedScore += time * weight;
    });

    if (totalTime === 0) return 0;
    
    // Normalize to 0-100 scale
    const rawScore = (weightedScore / totalTime);
    return Math.min(100, Math.round(rawScore * 10));
  }

  // Get category for domain (enhanced version)
  static getCategoryForDomain(domain) {
    const categoryMap = {
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

    return categoryMap[domain] || "misc";
  }

  // Generate streak data
  static calculateStreak(activityLog) {
    if (!activityLog || activityLog.length === 0) {
      return { current: 0, longest: 0, lastActive: null };
    }

    // Group activities by date
    const dailyActivity = {};
    activityLog.forEach(entry => {
      const date = new Date(entry.when).toDateString();
      if (!dailyActivity[date]) {
        dailyActivity[date] = { totalTime: 0, productiveTime: 0 };
      }
      
      const category = this.getCategoryForDomain(entry.domain);
      dailyActivity[date].totalTime += entry.timeSpent;
      
      if (['learning', 'productive'].includes(category)) {
        dailyActivity[date].productiveTime += entry.timeSpent;
      }
    });

    // Calculate streak (days with at least 30 minutes of productive time)
    const dates = Object.keys(dailyActivity).sort((a, b) => new Date(b) - new Date(a));
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    const today = new Date().toDateString();
    let checkingCurrent = true;

    dates.forEach(date => {
      const day = dailyActivity[date];
      const isProductiveDay = day.productiveTime >= 1800; // 30 minutes

      if (isProductiveDay) {
        tempStreak++;
        if (checkingCurrent && (date === today || currentStreak > 0)) {
          currentStreak = tempStreak;
        }
      } else {
        if (checkingCurrent) {
          checkingCurrent = false;
        }
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 0;
      }
    });

    longestStreak = Math.max(longestStreak, tempStreak);

    return {
      current: currentStreak,
      longest: longestStreak,
      lastActive: dates[0] || null
    };
  }

  // Generate achievements based on activity
  static generateAchievements(activityLog, streakData) {
    const achievements = [
      {
        id: 'first_day',
        name: 'Getting Started',
        description: 'Complete your first day of tracking',
        icon: '🌱',
        unlocked: activityLog && activityLog.length > 0
      },
      {
        id: 'productive_hour',
        name: 'Focused Hour',
        description: 'Spend 1 hour on productive activities',
        icon: '⏰',
        unlocked: this.hasProductiveTime(activityLog, 3600)
      },
      {
        id: 'week_streak',
        name: 'Week Warrior',
        description: 'Maintain a 7-day productivity streak',
        icon: '🔥',
        unlocked: streakData.current >= 7 || streakData.longest >= 7
      },
      {
        id: 'learning_master',
        name: 'Learning Master',
        description: 'Spend 5 hours learning in a week',
        icon: '📚',
        unlocked: this.hasWeeklyLearning(activityLog, 18000)
      },
      {
        id: 'balanced_day',
        name: 'Balanced Life',
        description: 'Have a day with both learning and entertainment',
        icon: '⚖️',
        unlocked: this.hasBalancedDay(activityLog)
      },
      {
        id: 'early_bird',
        name: 'Early Bird',
        description: 'Start productive work before 9 AM',
        icon: '🌅',
        unlocked: this.hasEarlyActivity(activityLog)
      }
    ];

    return achievements;
  }

  // Helper methods for achievements
  static hasProductiveTime(activityLog, targetSeconds) {
    if (!activityLog) return false;
    
    const productiveTime = activityLog
      .filter(entry => ['learning', 'productive'].includes(this.getCategoryForDomain(entry.domain)))
      .reduce((total, entry) => total + entry.timeSpent, 0);
    
    return productiveTime >= targetSeconds;
  }

  static hasWeeklyLearning(activityLog, targetSeconds) {
    if (!activityLog) return false;
    
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    
    const weeklyLearning = activityLog
      .filter(entry => {
        const entryDate = new Date(entry.when);
        return entryDate >= oneWeekAgo && this.getCategoryForDomain(entry.domain) === 'learning';
      })
      .reduce((total, entry) => total + entry.timeSpent, 0);
    
    return weeklyLearning >= targetSeconds;
  }

  static hasBalancedDay(activityLog) {
    if (!activityLog) return false;
    
    const dailyActivity = {};
    activityLog.forEach(entry => {
      const date = new Date(entry.when).toDateString();
      if (!dailyActivity[date]) {
        dailyActivity[date] = { learning: false, entertainment: false };
      }
      
      const category = this.getCategoryForDomain(entry.domain);
      if (category === 'learning') dailyActivity[date].learning = true;
      if (category === 'entertainment') dailyActivity[date].entertainment = true;
    });

    return Object.values(dailyActivity).some(day => day.learning && day.entertainment);
  }

  static hasEarlyActivity(activityLog) {
    if (!activityLog) return false;
    
    return activityLog.some(entry => {
      const entryTime = new Date(entry.when);
      const hour = entryTime.getHours();
      const category = this.getCategoryForDomain(entry.domain);
      return hour < 9 && ['learning', 'productive'].includes(category);
    });
  }

  // Theme management
  static setTheme(theme) {
    const root = document.documentElement;
    
    if (theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      theme = prefersDark ? 'dark' : 'light';
    }
    
    root.setAttribute('data-theme', theme);
    chrome.storage.local.set({ theme: theme });
  }

  static getTheme() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['theme'], (result) => {
        resolve(result.theme || 'dark');
      });
    });
  }

  // Date utilities
  static getDateRange(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    switch (period) {
      case 'today':
        return { start: today, end: now };
      
      case 'week':
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        return { start: weekStart, end: now };
      
      case 'month':
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        return { start: monthStart, end: now };
      
      default:
        return { start: today, end: now };
    }
  }

  // Data export utilities
  static exportToJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-diary-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Debounce utility
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Storage utilities
  static async getStorageData(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  static async setStorageData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, resolve);
    });
  }
}

// Make Utils available globally
window.Utils = Utils;