// Injects a simple overlay for translated captions and listens for messages from popup.
let overlay = null;

function createOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'yt-translator-overlay';
  Object.assign(overlay.style, {
    position: 'fixed', bottom: '72px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(2,6,23,0.8)', color: '#e6eef6', padding: '10px 14px',
    borderRadius: '8px', maxWidth: '90%', zIndex: 999999, fontSize: '16px', textAlign: 'center',
    boxShadow: '0 6px 24px rgba(10,15,30,0.6)'
  });
  document.documentElement.appendChild(overlay);
  return overlay;
}

function clearOverlay() {
  try {
    if (overlay) { overlay.remove(); overlay = null; }
  } catch (e) {}
  try {
    if (overlayDiv && overlayDiv.parentNode) { overlayDiv.parentNode.removeChild(overlayDiv); overlayDiv = null; }
  } catch (e) {}
}

async function extractVisibleCaptions() {
  // Try to find YouTube's caption container text
  const nodes = Array.from(document.querySelectorAll('.caption-window, .ytp-caption-segment, .ytp-caption-window-container, .captions-text, .ytp-caption-segment'));
  const text = nodes.map(n => n.innerText || n.textContent).filter(Boolean).join('\n');
  return text || document.querySelector('.ytp-caption-window-container')?.innerText || '';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'translate_captions') {
    extractVisibleCaptions().then((captions) => {
      if (!captions) { sendResponse({ status: 'No captions found on this page', text: '' }); return; }
      // No API configured: return raw captions for caller to handle locally
      sendResponse({ status: 'no_api_configured', text: captions });
    });
    return true; // async
  } else if (msg.action === 'clear_overlay') {
    clearOverlay();
    sendResponse({ status: 'Overlay removed' });
  } else if (msg.action === 'overlay_translation' && typeof msg.text === 'string') {
    showOverlay(msg.text);
    sendResponse({ status: 'ok' });
  }
});

(function () {
  // Keep last seen caption text
  let lastCaption = '';
  let observer = null;
  let overlayEl = null;

  function findCaptionElements() {
    // Try multiple selectors used by various YouTube builds
    const selectors = [
      '.ytp-caption-segment',                 // common
      '.ytp-caption-window-container',        // container
      '.captions-text',                       // some builds
      '.caption-window',                      // legacy
      '.ytp-subtitles-text'                   // alternate
    ];
    const found = [];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(n => found.push(n));
    });
    return found;
  }

  function readCaptionFromDOM() {
    // Attempt to read concatenated visible caption segments
    const segs = document.querySelectorAll('.ytp-caption-segment, .ytp-subtitles-text, .captions-text');
    if (segs && segs.length) {
      let text = '';
      segs.forEach(s => { const t = s.textContent && s.textContent.trim(); if (t) text += (text ? ' ' : '') + t; });
      return text.trim();
    }
    // Fallback: try YouTube's player container captions text
    const win = document.querySelector('.ytp-caption-window-container');
    if (win) return (win.textContent || '').trim();
    return '';
  }

  function ensureOverlay() {
    if (overlayEl && document.body.contains(overlayEl)) return overlayEl;
    overlayEl = document.createElement('div');
    overlayEl.id = 'yt-translate-overlay';
    Object.assign(overlayEl.style, {
      position: 'absolute', left: '8px', right: '8px', bottom: '10%',
      zIndex: 9999999, pointerEvents: 'none', padding: '6px 10px', borderRadius: '6px',
      background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: '16px',
      maxWidth: 'calc(100% - 16px)', boxSizing: 'border-box'
    });
    // Attach to player container if possible
    const player = document.querySelector('.html5-video-player') || document.body;
    player.appendChild(overlayEl);
    return overlayEl;
  }

  function removeOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
  }

  function updateLastCaption(text) {
    if (!text) return;
    lastCaption = text;
  }

  function observeCaptions() {
    // If already observing, skip
    if (observer) return;
    // Find a parent node to observe; prefer player container
    const root = document.querySelector('.html5-video-player') || document.querySelector('ytd-player') || document.body;
    if (!root) return;
    observer = new MutationObserver(() => {
      const text = readCaptionFromDOM();
      if (text && text !== lastCaption) {
        lastCaption = text;
        // store on window (for quick access if needed)
        window.__yt_latest_caption = text;
      }
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    // initial read
    lastCaption = readCaptionFromDOM() || (window.__yt_latest_caption || '');
    if (lastCaption) window.__yt_latest_caption = lastCaption;
  }

  // Start observer shortly after script injected (allow DOM)
  setTimeout(observeCaptions, 500);

  // Message handler
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'ping') {
      sendResponse({ ok: true });
      return; // keep sync
    }
    if (msg.action === 'get_current_caption') {
      // return last known caption
      const caption = lastCaption || (window.__yt_latest_caption || '') || '';
      sendResponse({ text: caption });
      return true;
    }
    if (msg.action === 'clear_overlay') {
      removeOverlay();
      sendResponse({ status: 'overlay_cleared' });
      return true;
    }
  });

  // Expose a probe for fast checks
  window.__yt_latest_caption = lastCaption;
})();

let overlayDiv = null;

function showOverlay(text) {
  function getPlayerContainer() {
    // Prefer html5 player, fall back to ytd-player or body
    return document.querySelector('.html5-video-player') || document.querySelector('ytd-player') || document.body;
  }

  if (!overlayDiv) {
    overlayDiv = document.createElement('div');
    overlayDiv.id = 'yt-nigerian-caption-overlay';
    // Use absolute positioning relative to the player container so the caption sits above the controls
    overlayDiv.style.position = 'absolute';
    overlayDiv.style.bottom = '6%';
    overlayDiv.style.left = '50%';
    overlayDiv.style.transform = 'translateX(-50%) translateY(6px)';
    overlayDiv.style.background = 'rgba(0,0,0,0.64)';
    // Slightly darker lime green for readability and stronger weight
    overlayDiv.style.color = '#32CD32';
    overlayDiv.style.fontWeight = '600';
    // soft glow and depth to separate from video content
    overlayDiv.style.boxShadow = '0 6px 18px rgba(0,0,0,0.8), 0 0 10px rgba(50,205,50,0.08)';
    overlayDiv.style.padding = '6px 12px';
    overlayDiv.style.borderRadius = '6px';
    overlayDiv.style.fontSize = '16px';
    overlayDiv.style.lineHeight = '1.3';
    overlayDiv.style.zIndex = '9999999';
    overlayDiv.style.pointerEvents = 'none';
    overlayDiv.style.maxWidth = '90%';
    overlayDiv.style.boxSizing = 'border-box';
    overlayDiv.style.textAlign = 'center';
    overlayDiv.style.textShadow = '0 2px 4px rgba(0,0,0,0.9)';
    overlayDiv.style.wordBreak = 'break-word';
    // small animation for fade/slide
    overlayDiv.style.transition = 'opacity 220ms ease, transform 220ms ease';
    overlayDiv.style.opacity = '0';

    const player = getPlayerContainer();
    try {
      // If fullscreened, attach to fullscreen element so it stays visible
      const fs = document.fullscreenElement || document.webkitFullscreenElement || null;
      if (fs && fs.contains(player)) {
        fs.appendChild(overlayDiv);
      } else if (player && player.appendChild) {
        player.appendChild(overlayDiv);
      } else {
        document.body.appendChild(overlayDiv);
      }
    } catch (e) {
      document.body.appendChild(overlayDiv);
    }
  }
  overlayDiv.textContent = text || '';
  if (!text) {
    // hide with animation then remove
    overlayDiv.style.opacity = '0';
    overlayDiv.style.transform = 'translateX(-50%) translateY(6px)';
    // remove after transition
    setTimeout(() => { try { if (overlayDiv && overlayDiv.parentNode) overlayDiv.parentNode.removeChild(overlayDiv); overlayDiv = null; } catch(e){} }, 260);
  } else {
    overlayDiv.style.display = 'block';
    // force reflow then show
    requestAnimationFrame(() => {
      overlayDiv.style.opacity = '1';
      overlayDiv.style.transform = 'translateX(-50%) translateY(0)';
    });
  }
}

// Deprecated: overlay removal is handled by the unified `clearOverlay()` above.

// --- Page-level auto-translate (runs inside the content script so it continues
// while the YouTube page/tab is open, even if the popup is closed) ---
let pageAuto = { intervalId: null, lastCaption: '', target: null, running: false };

async function readPreferredLangFromStorage() {
  return new Promise((resolve) => {
    try {
      if (chrome && chrome.storage && chrome.storage.sync && chrome.storage.sync.get) {
        chrome.storage.sync.get({ preferredLang: 'yo' }, (res) => {
          if (res && res.preferredLang) return resolve(res.preferredLang);
          // fallback to local
          if (chrome.storage.local && chrome.storage.local.get) {
            chrome.storage.local.get({ preferredLang: 'yo' }, (r2) => { resolve((r2 && r2.preferredLang) ? r2.preferredLang : 'yo'); });
          } else resolve(localStorage.getItem('preferredLang') || 'yo');
        });
        return;
      }
    } catch (e) {}
    try { resolve(localStorage.getItem('preferredLang') || 'yo'); } catch (e) { resolve('yo'); }
  });
}

async function translateViaLocalServer(text, targetCode) {
  if (!text) return '';
  // Prefer asking background/service worker to perform the translation (avoids CORS in page context)
  try {
    const resp = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'translate_request', text, target: targetCode || 'yo' }, (r) => resolve(r));
      } catch (e) { resolve(null); }
    });
    if (resp && typeof resp.text === 'string' && resp.text.trim()) return resp.text.trim();
  } catch (e) {}
  // Fallback: attempt direct fetch from page (may be blocked by CORS)
  try {
    const shortText = (text.length > 800) ? text.slice(-800) : text;
    const langName = targetCode || 'yo';
    const payload = {
      model: 'local',
      messages: [
        { role: 'system', content: `You are a translation assistant. Translate ONLY the user's text into ${langName}. Output only the translation.` },
        { role: 'user', content: `Translate this to ${langName}: ${shortText}` }
      ],
      max_tokens: 256,
      temperature: 0.1
    };
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 25000);
    const resp2 = await fetch('http://127.0.0.1:8080/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    clearTimeout(to);
    if (resp2 && resp2.ok) {
      const data = await resp2.json();
      const content = (data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text)) || '';
      if (content && content.trim()) return content.trim();
    }
  } catch (e) {}
  return '(translation error: Could not reach llama-server)';
}

async function pageAutoTick() {
  try {
    const caption = (window.__yt_latest_caption && window.__yt_latest_caption.trim()) || readCaptionFromDOM();
    if (!caption) return;
    if (caption === pageAuto.lastCaption) return;
    pageAuto.lastCaption = caption;
    const target = pageAuto.target || await readPreferredLangFromStorage();
    pageAuto.target = target;
    // show quick placeholder while translating
    showOverlay('Translating…');
    const translated = await translateViaLocalServer(caption, target);
    if (translated) showOverlay(translated);
  } catch (e) {
    // ignore
  }
}

async function startPageAutoTranslate() {
  try {
    // only start on pages with video player
    const player = document.querySelector('.html5-video-player') || document.querySelector('ytd-player');
    if (!player) return false;
    if (pageAuto.running) return true;
      pageAuto.target = await readPreferredLangFromStorage();
      // reset lastCaption so we always translate immediately when starting
      pageAuto.lastCaption = '';
      pageAuto.intervalId = setInterval(pageAutoTick, 900);
    pageAuto.running = true;
    // do an immediate tick
    pageAutoTick();
    return true;
  } catch (e) { return false; }
}

function stopPageAutoTranslate() {
  try {
    if (pageAuto.intervalId) { clearInterval(pageAuto.intervalId); pageAuto.intervalId = null; }
    pageAuto.running = false;
    pageAuto.lastCaption = '';
    return true;
  } catch (e) { return false; }
}

// Start auto-translation when content script loads on a YouTube player page
try { startPageAutoTranslate(); } catch (e) {}

// Inject a small on-page toggle so user can control page auto-translate without opening popup
function createPageToggle() {
  try {
    const player = document.querySelector('.html5-video-player') || document.querySelector('ytd-player');
    if (!player) return;
    // avoid duplicate
    if (document.getElementById('yt-page-auto-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'yt-page-auto-toggle';
    btn.title = 'Toggle translated captions';
    btn.setAttribute('aria-pressed', 'false');
    Object.assign(btn.style, {
      position: 'absolute', top: '8px', right: '8px', zIndex: 10000000,
      background: 'linear-gradient(180deg, rgba(60,179,113,0.95), rgba(34,139,34,0.9))',
      color: '#fff', border: 'none', padding: '6px 10px',
      borderRadius: '6px', cursor: 'pointer', fontSize: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      transition: 'transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease'
    });
    btn.textContent = 'Translate: On';

    async function refreshState() {
      try {
        const saved = (localStorage.getItem('yt_page_auto_enabled') || 'true') === 'true';
        if (saved) {
          btn.textContent = 'Translate: On';
          btn.style.background = 'linear-gradient(180deg, rgba(60,179,113,0.95), rgba(34,139,34,0.9))';
          btn.style.opacity = '1';
          btn.setAttribute('aria-pressed', 'true');
          // force re-translate when toggled back on
          pageAuto.lastCaption = '';
          if (!pageAuto.running) startPageAutoTranslate(); else pageAutoTick();
        } else {
          btn.textContent = 'Translate: Off';
          btn.style.background = 'linear-gradient(180deg, rgba(180,60,60,0.95), rgba(120,20,20,0.9))';
          btn.style.opacity = '0.92';
          btn.setAttribute('aria-pressed', 'false');
          if (pageAuto.running) { stopPageAutoTranslate(); clearOverlay(); }
        }
      } catch (e) {}
    }

    btn.addEventListener('click', () => {
      try {
        const enabled = btn.getAttribute('aria-pressed') === 'true';
        localStorage.setItem('yt_page_auto_enabled', (!enabled).toString());
        refreshState();
      } catch (e) {}
    });
    // hover and active feedback
    btn.addEventListener('mouseenter', () => { try { btn.style.transform = 'translateY(-2px)'; btn.style.boxShadow = '0 8px 22px rgba(0,0,0,0.6)'; } catch(e){} });
    btn.addEventListener('mouseleave', () => { try { btn.style.transform = 'translateY(0)'; btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)'; } catch(e){} });
    btn.addEventListener('mousedown', () => { try { btn.style.transform = 'translateY(0) scale(0.99)'; } catch(e){} });
    btn.addEventListener('mouseup', () => { try { btn.style.transform = 'translateY(-2px)'; } catch(e){} });

    player.style.position = player.style.position || 'relative';
    player.appendChild(btn);
    // Initialize from storage
    refreshState();
  } catch (e) {}
}

try { createPageToggle(); } catch (e) {}

// Allow external messages to control page auto-translate (start/stop)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;
  if (msg.action === 'start_page_auto') {
    startPageAutoTranslate().then(r => sendResponse({ status: r ? 'started' : 'failed' }));
    return true;
  }
  if (msg.action === 'stop_page_auto') {
    const ok = stopPageAutoTranslate();
    sendResponse({ status: ok ? 'stopped' : 'none' });
    return true;
  }
  // allow setting target language from popup/background
  if (msg.action === 'set_target_lang' && msg.target) {
    try {
      pageAuto.target = msg.target;
      pageAuto.lastCaption = '';
      // persist preference locally
      try { localStorage.setItem('preferredLang', msg.target); } catch (e) {}
      try { chrome.storage && chrome.storage.sync && chrome.storage.sync.set && chrome.storage.sync.set({ preferredLang: msg.target }); } catch (e) {}
      // force immediate translation
      pageAutoTick();
      sendResponse({ status: 'ok' });
    } catch (e) { sendResponse({ status: 'error' }); }
    return true;
  }
});

// Languages available in popup; keep in sync with popup.js
const LANGS = [
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' }
];

function updateLangButtonLabel(btn, code) {
  try {
    if (!btn) btn = document.getElementById('yt-lang-control-btn');
    if (!btn) return;
    const lang = (LANGS.find(l => l.code === code) || LANGS[0]);
    const name = lang ? lang.code.toUpperCase() : (code || '??').toUpperCase();
    btn.textContent = name;
    btn.title = lang ? `Translate to ${lang.name}` : 'Change language';
  } catch (e) {}
}

function setTargetLangFromPage(newCode) {
  try {
    if (!newCode) return;
    pageAuto.target = newCode;
    pageAuto.lastCaption = '';
    // persist
    try { localStorage.setItem('preferredLang', newCode); } catch (e) {}
    try { chrome.storage && chrome.storage.sync && chrome.storage.sync.set && chrome.storage.sync.set({ preferredLang: newCode }); } catch (e) {}
    // immediate re-translate
    pageAutoTick();
    // update UI
    updateLangButtonLabel();
    showLangToast(newCode);
  } catch (e) {}
}

// Listen for storage changes (when popup updates preferredLang)
try {
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (changes && changes.preferredLang && changes.preferredLang.newValue) {
        try {
          pageAuto.target = changes.preferredLang.newValue;
          pageAuto.lastCaption = '';
          pageAutoTick();
          updateLangButtonLabel();
          showLangToast(changes.preferredLang.newValue);
        } catch (e) {}
      }
    });
  }
} catch (e) {}

// Inject a small green language selector in the player
function createLangControl() {
  try {
    const player = document.querySelector('.html5-video-player') || document.querySelector('ytd-player');
    if (!player) return;
    if (document.getElementById('yt-lang-control')) return;

    const container = document.createElement('div');
    container.id = 'yt-lang-control';
    // We'll position responsively after creating elements
    Object.assign(container.style, { position: 'absolute', zIndex: 10000001 });

    const btn = document.createElement('button');
    btn.id = 'yt-lang-control-btn';
    btn.title = 'Change translation language';
    Object.assign(btn.style, {
      width: '36px', height: '36px', borderRadius: '50%', border: 'none', cursor: 'pointer',
      background: 'linear-gradient(180deg, #32CD32, #228B22)', color: '#fff', fontWeight: '700',
      boxShadow: '0 6px 18px rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const menu = document.createElement('div');
    menu.id = 'yt-lang-control-menu';
    Object.assign(menu.style, {
      display: 'none', position: 'absolute', top: '44px', left: '0', background: 'rgba(0,0,0,0.85)',
      color: '#fff', padding: '6px 8px', borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.6)'
    });

    LANGS.forEach(l => {
      const item = document.createElement('div');
      item.textContent = l.name;
      Object.assign(item.style, { padding: '6px 8px', cursor: 'pointer', whiteSpace: 'nowrap' });
      item.addEventListener('click', () => {
        setTargetLangFromPage(l.code);
        menu.style.display = 'none';
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.04)'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      menu.appendChild(item);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = (menu.style.display === 'none') ? 'block' : 'none';
    });

    // close menu when clicking outside
    document.addEventListener('click', () => { try { menu.style.display = 'none'; } catch (e) {} });

    container.appendChild(btn);
    container.appendChild(menu);
    player.style.position = player.style.position || 'relative';
    player.appendChild(container);

    // Position control intelligently to avoid overlapping player controls on small screens
    function positionControl() {
      try {
        const rightCtrl = player.querySelector('.ytp-right-controls') || player.querySelector('.ytp-chrome-top') || null;
        const playerRect = player.getBoundingClientRect();
        const small = playerRect.width < 520;
        if (rightCtrl && !small) {
          // place at top-left with slight inset so it doesn't collide with right controls
          container.style.top = '8px';
          container.style.left = '8px';
        } else if (small) {
          // on small players, move control to top-right but slightly inset
          container.style.top = '8px';
          container.style.right = '8px';
          container.style.left = 'auto';
        } else {
          container.style.top = '8px';
          container.style.left = '8px';
        }
      } catch (e) {}
    }

    // reposition on resize or UI changes
    try { new ResizeObserver(positionControl).observe(player); } catch (e) { window.addEventListener('resize', positionControl); }

    // Initialize button label from storage
    (async () => {
      const pref = await readPreferredLangFromStorage();
      updateLangButtonLabel(btn, pref);
      pageAuto.target = pref;
      positionControl();
    })();
  } catch (e) {}
}

try { createLangControl(); } catch (e) {}

// --- Toast for language change confirmations ---
function showLangToast(langCode) {
  try {
    const player = document.querySelector('.html5-video-player') || document.querySelector('ytd-player') || document.body;
    if (!player) return;
    let toast = document.getElementById('yt-lang-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'yt-lang-toast';
      Object.assign(toast.style, {
        position: 'absolute',
        background: 'rgba(0,0,0,0.72)', color: '#E9FBEF', padding: '8px 12px', borderRadius: '6px',
        zIndex: 10000002, fontSize: '13px', boxShadow: '0 6px 18px rgba(0,0,0,0.6)', opacity: '0', transition: 'opacity 220ms ease, transform 220ms ease',
        pointerEvents: 'none', transform: 'translateX(-50%) translateY(0)'
      });
      player.appendChild(toast);
    }
    const langName = (LANGS.find(l => l.code === langCode) || {}).name || langCode;
    toast.textContent = `Language set: ${langName}`;
    // position to the right side of the language control button (preferred)
    try {
      const btn = document.getElementById('yt-lang-control-btn');
      if (btn) {
        const btnRect = btn.getBoundingClientRect();
        const playerRect = player.getBoundingClientRect();
        // ensure toast has natural width for measurement
        toast.style.left = '0px';
        toast.style.top = '0px';
        toast.style.display = 'block';
        const toastW = toast.offsetWidth || 120;
        const toastH = toast.offsetHeight || 28;
        // attempt to place to the right of the button with a small horizontal gap
        const gap = 12;
        let left = btnRect.right - playerRect.left + gap;
        let top = btnRect.top - playerRect.top + (btnRect.height / 2) - (toastH / 2);
        // if it would overflow on the right, place on the left side instead
        if (left + toastW + gap > playerRect.width) {
          left = btnRect.left - playerRect.left - gap - toastW;
          // if left would be negative (no space), clamp to 8px
          if (left < 8) left = 8;
        }
        // clamp vertical position inside player
        if (top < 8) top = 8;
        if (top + toastH > playerRect.height - 8) top = playerRect.height - toastH - 8;
        toast.style.left = left + 'px';
        toast.style.top = top + 'px';
        // mark as side-positioned (no horizontal centering)
        toast.dataset.pos = 'side';
        toast.style.transform = 'none';
      } else {
        // fallback: centered near bottom
        toast.dataset.pos = 'center';
        toast.style.left = '50%';
        toast.style.bottom = '18%';
        toast.style.top = '';
        toast.style.transform = 'translateX(-50%) translateY(0)';
      }
    } catch (e) {
      toast.dataset.pos = 'center';
      toast.style.left = '50%';
      toast.style.bottom = '18%';
      toast.style.top = '';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    }
    // animate in according to position
    requestAnimationFrame(() => {
      try {
        if (toast.dataset.pos === 'side') {
          toast.style.opacity = '1';
          // keep transform as 'none' so it stays aligned to left/top
        } else {
          toast.style.opacity = '1';
          toast.style.transform = 'translateX(-50%) translateY(0)';
        }
      } catch (e) {}
    });
    // hide after 2s
    setTimeout(() => {
      try {
        if (toast.dataset.pos === 'side') {
          toast.style.opacity = '0';
          // slide slightly to the right while fading
          toast.style.transform = 'translateX(6px)';
        } else {
          toast.style.opacity = '0';
          toast.style.transform = 'translateX(-50%) translateY(6px)';
        }
      } catch (e) {}
    }, 1800);
    // remove after transition
    setTimeout(() => { try { if (toast && toast.parentNode) toast.parentNode.removeChild(toast); } catch (e) {} }, 2200);
  } catch (e) {}
}