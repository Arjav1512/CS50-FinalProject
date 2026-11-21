// DOM and browser helpers shared by the popup and the options page.
// Rule: page text, stored data and fetched data are only ever inserted as text
// nodes (via h() children or textContent) — never as HTML.

// h('div', { class: 'x', onclick: fn }, 'text', childNode, [more]) → element
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') el[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function setChildren(el, ...children) {
  el.replaceChildren();
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function downloadFile(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const todayStamp = () => new Date().toISOString().slice(0, 10);

// Theme: "light", "dark" or "auto" (follow the system). "auto" is stored as-is.
export function applyTheme(theme) {
  let resolved = theme;
  if (theme === 'auto') resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', resolved === 'light' ? 'light' : 'dark');
  return resolved;
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export const storageGet = keys => chrome.storage.local.get(keys);
export const storageSet = items => chrome.storage.local.set(items);
export const sendToWorker = msg => chrome.runtime.sendMessage(msg);
