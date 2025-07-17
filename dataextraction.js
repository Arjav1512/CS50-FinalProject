function grabContent() {
  let text = "";

  // try to grab main content
  const article = document.querySelector("article");
  if (article) {
    text = article.innerText;
  } else {
    // fallback: grab some paragraph text
    const paras = document.querySelectorAll("p");
    for (let i = 0; i < Math.min(5, paras.length); i++) {
      text += paras[i].innerText + "\n";
    }
  }

  // fallback fallback lol
  if (!text) text = document.title;

  return text.slice(0, 3000); // trim to keep Gemini happy
}

// Only run if we're not on a chrome:// page
if (!window.location.href.startsWith("chrome://")) {
  const content = grabContent();

  chrome.runtime.sendMessage({
    type: "summarize",
    text: content,
    url: window.location.href
  }).catch(err => {
    // Handle cases where background script isn't ready
    console.log("Background script not ready yet");
  });
}
