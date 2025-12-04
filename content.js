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
    extractVisibleCaptions().then(captions => {
      if (!captions) { sendResponse({ status: 'No captions found on this page' }); return; }
      chrome.runtime.sendMessage({ action: 'translate_request', text: captions, target: msg.target }, resp => {
        const translated = resp?.text || ('['+msg.target+'] ' + captions);
        createOverlay().textContent = translated;
        sendResponse({ status: 'Translation displayed' });
      });
    });
    return true; // async
  } else if (msg.action === 'clear_overlay') {
    clearOverlay();
    sendResponse({ status: 'Overlay removed' });
  }
});