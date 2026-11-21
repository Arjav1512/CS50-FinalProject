// Utility functions for the Digital Diary extension

import * as core from './lib/core.js';

export class Utils {
  static formatTime(seconds) { return core.formatTime(seconds); }
  static calculateProductivityScore(log) { return core.calculateProductivityScore(log); }
  static getCategoryForDomain(domain) { return core.getCategoryForDomain(domain); }
  static calculateStreak(log) { return core.calculateStreak(log); }
  static generateAchievements(log, streak) { return core.generateAchievements(log, streak); }

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

  static getDateRange(period) { return core.getDateRange(period); }

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
