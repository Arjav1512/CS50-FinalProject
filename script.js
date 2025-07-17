document.addEventListener('DOMContentLoaded', function() {
    const reportDiv = document.getElementById("report");

    // Add timeout to ensure storage is ready
    setTimeout(() => {
        chrome.storage.local.get(["activityLog"], (data) => {
            console.log("Storage data retrieved:", data);
            const log = data.activityLog || [];

            if (chrome.runtime.lastError) {
                console.error("Storage error:", chrome.runtime.lastError);
                reportDiv.innerHTML = "Error loading data. Try refreshing the extension.";
                return;
            }

            if (!log || log.length === 0) {
                reportDiv.innerHTML = "bruh... u didn't even open anything today??<br><small>Try browsing some websites first, then come back!</small>";
                return;
            }

            // Debug logging
            console.log("Processing", log.length, "activity entries");

            // Use consistent category mapping
            const categories = {
                "youtube.com": "entertainment",
                "netflix.com": "entertainment",
                "wikipedia.org": "learning",
                "medium.com": "learning",
                "amazon.com": "shopping",
                "flipkart.com": "shopping",
                "twitter.com": "social media",
                "github.com": "productive",
                "chat.openai.com": "productive",
                "chatgpt.com": "productive",
                "claude.ai": "productive",
                "instagram.com": "entertainment",
                "bennett.edu.in": "learning"
            };

            const categoryTime = {};
            const domainBreakdown = {};

            log.forEach(entry => {
                const domain = entry.domain;
                const time = entry.timeSpent;
                const category = categories[domain] || "misc";

                categoryTime[category] = (categoryTime[category] || 0) + time;
                domainBreakdown[domain] = (domainBreakdown[domain] || 0) + time;
            });

            // Check if we have any meaningful data
            const totalTime = Object.values(categoryTime).reduce((a, b) => a + b, 0);
            if (totalTime === 0) {
                reportDiv.innerHTML = "No significant browsing time recorded yet. Browse for a bit longer!";
                return;
            }

            let html = `<h3>🕒 Time Spent by Category</h3><ul>`;
            for (const [cat, secs] of Object.entries(categoryTime)) {
                const mins = Math.round(secs / 60);
                if (mins > 0) {
                    html += `<li><strong>${cat}</strong>: ${mins} mins</li>`;
                }
            }
            html += `</ul>`;

            html += `<h3>🌐 Domains Visited</h3><ul>`;
            for (const [domain, secs] of Object.entries(domainBreakdown)) {
                const mins = Math.round(secs / 60);
                if (mins > 0) {
                    html += `<li>${domain}: ${mins} mins</li>`;
                }
            }
            html += `</ul>`;

            const sortedCats = Object.entries(categoryTime).sort((a, b) => b[1] - a[1]);
            const topCategory = sortedCats[0]?.[0];
            if (topCategory) {
                html += `<h3>💡 Insight</h3>`;
                html += `<p>You mostly spent time on <strong>${topCategory}</strong>. Maybe ask yourself: "was that on purpose?" 😬</p>`;
            }

            html += `<h3>📚 Learning Suggestions</h3>`;
            if (categoryTime["entertainment"] > (categoryTime["learning"] || 0)) {
                html += `<p>Try mixing in some reading tomorrow. Maybe hit up Medium or Coursera for 15 mins?</p>`;
            } else {
                html += `<p>Nice. You did some learning today! Keep that streak going.</p>`;
            }

            // Add Gemini Summaries
            chrome.storage.local.get(["summaries"], (summaryData) => {
                const summaries = summaryData.summaries || [];
                if (summaries.length > 0) {
                    html += `<h3>📖 Stuff You (Maybe) Learned</h3><ul>`;
                    summaries.slice(-3).forEach(entry => {
                        try {
                            const hostname = new URL(entry.url).hostname;
                            html += `<li><strong>${hostname}</strong>:<br>${entry.summary}</li><br>`;
                        } catch (e) {
                            html += `<li><strong>Unknown site</strong>:<br>${entry.summary}</li><br>`;
                        }
                    });
                    html += `</ul>`;
                }

                reportDiv.innerHTML = html;
            });
        });
    }, 500); // Wait 500ms for storage to be ready

    // Debug button functionality
    document.getElementById('debugBtn').addEventListener('click', function() {
        chrome.storage.local.get(null, (data) => {
            console.log("All storage data:", data);
            alert("Check console for storage data");
        });
    });

    // Add a button to clear test data and start fresh
    document.getElementById('clearDataBtn').addEventListener('click', function() {
        chrome.storage.local.clear(() => {
            console.log("All data cleared");
            alert("Data cleared! Start browsing to see real activity.");
            location.reload();
        });
    });
});
