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
  if (overlay) overlay.remove(), overlay = null;
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
    overlayEl.style.position = 'absolute';
    overlayEl.style.left = '8px';
    overlayEl.style.right = '8px';
    overlayEl.style.bottom = '10%';
    overlayEl.style.zIndex = 9999999;
    overlayEl.style.pointerEvents = 'none';
    overlayEl.style.padding = '6px 10px';
    overlayEl.style.borderRadius = '6px';
    overlayEl.style.background = 'rgba(0,0,0,0.6)';
    overlayEl.style.color = '#fff';
    overlayEl.style.fontSize = '16px';
    overlayEl.style.maxWidth = 'calc(100% - 16px)';
    overlayEl.style.boxSizing = 'border-box';
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
  if (!overlayDiv) {
    overlayDiv = document.createElement('div');
    overlayDiv.id = 'yt-nigerian-caption-overlay';
    overlayDiv.style.position = 'fixed';
    overlayDiv.style.bottom = '12%';
    overlayDiv.style.left = '50%';
    overlayDiv.style.transform = 'translateX(-50%)';
    overlayDiv.style.background = 'rgba(0,0,0,0.7)';
    overlayDiv.style.color = '#fff';
    overlayDiv.style.padding = '12px 24px';
    overlayDiv.style.borderRadius = '8px';
    overlayDiv.style.fontSize = '1.5em';
    overlayDiv.style.zIndex = '9999';
    overlayDiv.style.pointerEvents = 'none';
    overlayDiv.style.maxWidth = '80vw';
    overlayDiv.style.textAlign = 'center';
    document.body.appendChild(overlayDiv);
  }
  overlayDiv.textContent = text;
  overlayDiv.style.display = 'block';
}

function clearOverlay() {
  if (overlayDiv) {
    overlayDiv.style.display = 'none';
    overlayDiv.textContent = '';
  }
}