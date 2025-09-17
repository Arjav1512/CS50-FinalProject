let sessions = {};
let currentActiveTab = null;
let settings = {};

// Load settings on startup
chrome.storage.local.get([
  'minTrackingTime',
  'excludedDomains', 
  'enableSummaries',
  'autoExportNotion'
], (data) => {
  settings = {
    minTrackingTime: data.minTrackingTime || 5,
    excludedDomains: data.excludedDomains || ['chrome://', 'chrome-extension://', 'localhost'],
    enableSummaries: data.enableSummaries !== false,
    autoExportNotion: data.autoExportNotion || false
  };
  console.log('[SETTINGS] Loaded:', settings);
});

// Track when a tab is activated
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // End tracking for previously active tab
  if (currentActiveTab && sessions[currentActiveTab]) {
    endSession(currentActiveTab);
  }

  chrome.tabs.get(tabId, (tab) => {
    if (!tab || !tab.url || isExcludedUrl(tab.url)) return;

    sessions[tabId] = {
      url: tab.url,
      startTime: Date.now()
    };

    currentActiveTab = tabId;
    console.log("[TRACKING] Tab activated:", tab.url);
  });
});

// Track when a tab is updated (URL change)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && tabId === currentActiveTab) {
    if (isExcludedUrl(changeInfo.url)) return;

    // End current session and start new one
    if (sessions[tabId]) {
      endSession(tabId);
    }

    sessions[tabId] = {
      url: changeInfo.url,
      startTime: Date.now()
    };

    console.log("[TRACKING] Tab updated:", changeInfo.url);
  }
});

// Track when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (sessions[tabId]) {
    endSession(tabId);
  }

  if (currentActiveTab === tabId) {
    currentActiveTab = null;
  }
});

// Helper function to check if URL should be excluded
function isExcludedUrl(url) {
  if (!url) return true;
  
  return settings.excludedDomains.some(domain => 
    url.startsWith(domain) || url.includes(domain)
  );
}

// Function to end a session and log the data
function endSession(tabId) {
  const session = sessions[tabId];
  if (!session) return;

  const endTime = Date.now();
  const duration = Math.round((endTime - session.startTime) / 1000);
  let domain = "unknown";

  try {
    domain = new URL(session.url).hostname;
  } catch (err) {
    console.error("Invalid URL:", session.url);
    domain = "unknown";
  }

  // Only log if user spent more than minimum tracking time
  if (duration >= settings.minTrackingTime) {
    console.log("[TRACKING] Session ended:", domain, "Time:", duration);

    const logEntry = {
      domain: domain,
      timeSpent: duration,
      when: new Date().toLocaleString(),
      url: session.url,
      category: getCategoryForDomain(domain)
    };

    chrome.storage.local.get(["activityLog"], (data) => {
      if (chrome.runtime.lastError) {
        console.error("Storage error:", chrome.runtime.lastError);
        return;
      }

      const log = data.activityLog || [];
      log.push(logEntry);

      console.log("Saving log entry:", logEntry);
      console.log("Total entries:", log.length);

      chrome.storage.local.set({ activityLog: log }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error saving to storage:", chrome.runtime.lastError);
        } else {
          console.log("Successfully saved to storage");
        }
      });
    });
  }

  delete sessions[tabId];
}

// Enhanced category mapping function
function getCategoryForDomain(domain) {
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

// GEMINI API - Summarize webpage content
// TODO: Move this to a config file or use chrome.storage for API key
const GEMINI_API_KEY = "YOUR_API_KEY_HERE"; // Replace with your actual API key

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "summarize") {
    // Skip if summaries are disabled
    if (!settings.enableSummaries) {
      console.log("[GEMINI] Summaries disabled in settings");
      return;
    }

    // Skip if no API key is set
    if (GEMINI_API_KEY === "YOUR_API_KEY_HERE") {
      console.log("[GEMINI] API key not configured, skipping summarization");
      return;
    }

    const prompt = `Summarize the following webpage content in 2-3 bullet points with key takeaways:\n\n${msg.text}`;

    fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    })
    .then(res => res.json())
    .then(data => {
      const summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "No summary available.";
      console.log("[GEMINI SUMMARY]", msg.url, "\n", summary);

      // Store in local storage
      chrome.storage.local.get(["summaries"], (res) => {
        const all = res.summaries || [];
        all.push({ url: msg.url, summary: summary, time: new Date().toLocaleString() });
        chrome.storage.local.set({ summaries: all });
      });
    })
    .catch(err => {
      console.error("[GEMINI ERROR]", err);
    });
  }

  // Handle goal tracking messages
  if (msg.type === "goalProgress") {
    updateGoalProgress(msg.domain, msg.timeSpent);
  }
});

// Goal tracking functionality
function updateGoalProgress(domain, timeSpent) {
  chrome.storage.local.get(['currentGoal'], (data) => {
    const goal = data.currentGoal;
    if (!goal || !goal.active) return;

    const category = getCategoryForDomain(domain);
    let isRelevant = false;

    switch (goal.type) {
      case 'focus':
        isRelevant = ['learning', 'productive'].includes(category);
        break;
      case 'learning':
        isRelevant = category === 'learning';
        break;
      case 'limit':
        isRelevant = ['entertainment', 'social media'].includes(category);
        break;
    }

    if (isRelevant) {
      goal.progress = (goal.progress || 0) + timeSpent;
      chrome.storage.local.set({ currentGoal: goal });

      // Check if goal is completed
      if (goal.progress >= goal.duration) {
        goal.active = false;
        goal.completed = true;
        chrome.storage.local.set({ currentGoal: goal });
        
        // Show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'Goal Completed! 🎉',
          message: `You've completed your ${goal.type} session!`
        });
      }
    }
  });
}

// Track when browser window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus, end current session
    if (currentActiveTab && sessions[currentActiveTab]) {
      endSession(currentActiveTab);
    }
  } else {
    // Browser gained focus, start tracking active tab
    chrome.tabs.query({active: true, windowId: windowId}, (tabs) => {
      if (tabs[0]) {
        const tabId = tabs[0].id;
        chrome.tabs.onActivated.dispatch({tabId});
      }
    });
  }
});

// Auto-export to Notion (daily)
function checkAutoExport() {
  if (!settings.autoExportNotion) return;

  chrome.storage.local.get(['lastNotionExport'], (data) => {
    const lastExport = data.lastNotionExport;
    const today = new Date().toDateString();
    
    if (lastExport !== today) {
      exportTodayToNotion();
      chrome.storage.local.set({ lastNotionExport: today });
    }
  });
}

async function exportTodayToNotion() {
  const settings = await new Promise(resolve => {
    chrome.storage.local.get(['notionApiKey', 'notionDatabaseId'], resolve);
  });
  
  if (!settings.notionApiKey || !settings.notionDatabaseId) return;

  const data = await new Promise(resolve => {
    chrome.storage.local.get(['activityLog', 'summaries'], resolve);
  });

  const today = new Date().toDateString();
  const todayActivities = (data.activityLog || []).filter(entry => 
    new Date(entry.when).toDateString() === today
  );

  if (todayActivities.length === 0) return;

  // Generate summary and export to Notion
  const summary = generateDailySummary(todayActivities, data.summaries || []);
  
  try {
    await fetch('https://api.notion.com/v1/pages', {
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
    
    console.log('[NOTION] Auto-export successful');
  } catch (error) {
    console.error('[NOTION] Auto-export failed:', error);
  }
}

function generateDailySummary(activities, summaries) {
  const categoryTime = {};
  let totalTime = 0;

  activities.forEach(entry => {
    const category = entry.category || getCategoryForDomain(entry.domain);
    categoryTime[category] = (categoryTime[category] || 0) + entry.timeSpent;
    totalTime += entry.timeSpent;
  });

  let summary = `Daily Digital Activity Summary\n\n`;
  summary += `Total Time Tracked: ${formatTime(totalTime)}\n\n`;
  
  summary += `Time by Category:\n`;
  Object.entries(categoryTime)
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, seconds]) => {
      const percentage = ((seconds / totalTime) * 100).toFixed(1);
      summary += `• ${category}: ${formatTime(seconds)} (${percentage}%)\n`;
    });

  const today = new Date().toDateString();
  const todaySummaries = summaries.filter(item => 
    new Date(item.time).toDateString() === today
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

function formatTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// Check for auto-export daily
setInterval(checkAutoExport, 60000 * 60); // Check every hour
checkAutoExport(); // Check on startup