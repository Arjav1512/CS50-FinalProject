function getCategory(domain) {
  const map = {
    "youtube.com": "entertainment",
    "netflix.com": "entertainment",
    "wikipedia.org": "learning",
    "medium.com": "learning",
    "amazon.com": "shopping",
    "flipkart.com": "shopping",
    "twitter.com": "doomscrolling",
    "github.com": "learning",
    "chat.openai.com": "pretending to work"
    "instagram.com": "entertainment"
  };

  return map[domain] || "misc vibes";
}
