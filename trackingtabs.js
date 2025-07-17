let sessions = {};
let currentActiveTab = null;

// Track when a tab is activated
chrome.tabs.onActivated.addListener(({ tabId }) => {
  // End tracking for previously active tab
  if (currentActiveTab && sessions[currentActiveTab]) {
    endSession(currentActiveTab);
  }

  chrome.tabs.get(tabId, (tab) => {
    if (!tab || !tab.url || tab.url.startsWith("chrome://")) return;

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

  // Only log if user spent more than 5 seconds on the page
  if (duration >= 5) {
    console.log("[TRACKING] Session ended:", domain, "Time:", duration);

    const logEntry = {
      domain: domain,
      timeSpent: duration,
      when: new Date().toLocaleString(),
      url: session.url
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

// GEMINI API - Summarize webpage content
// TODO: Move this to a config file or use chrome.storage for API key
const GEMINI_API_KEY = "YOUR_API_KEY_HERE"; // Replace with your actual API key

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "summarize") {
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
});

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

