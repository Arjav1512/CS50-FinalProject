function grabContent() {
  let text = "";

  // try to grab main content
  const article = document.querySelector("article");
  if (article) {
    text = article.innerText;
  } else {
    // Enhanced content extraction
    const selectors = [
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content'
    ];
    
    let contentFound = false;
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        text = element.innerText;
        contentFound = true;
        break;
      }
    }
    
    if (!contentFound) {
      // fallback: grab some paragraph text
      const paras = document.querySelectorAll("p");
      for (let i = 0; i < Math.min(5, paras.length); i++) {
        text += paras[i].innerText + "\n";
      }
    }
  }

  // fallback fallback lol
  if (!text) text = document.title;

  return text.slice(0, 3000); // trim to keep Gemini happy
}

// Enhanced URL filtering
function shouldExtractContent() {
  const url = window.location.href;
  const excludedPatterns = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'about:',
    'file://',
    'localhost'
  ];
  
  return !excludedPatterns.some(pattern => url.startsWith(pattern));
}

// Only run content extraction on valid pages
if (shouldExtractContent()) {
  const content = grabContent();
  
  // Only send if we have meaningful content
  if (content && content.length > 50) {
    chrome.runtime.sendMessage({
      type: "summarize",
      text: content,
      url: window.location.href,
      title: document.title
    }).catch(err => {
      // Handle cases where background script isn't ready
      console.log("Background script not ready yet");
    });
  }
}