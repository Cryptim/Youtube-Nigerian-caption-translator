let pinnedWindowId = null;

// Service worker: handles translations (placeholder) and future API calls.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.action) return;

  if (msg.action === 'create_pinned_window') {
    if (pinnedWindowId) {
      chrome.windows.update(pinnedWindowId, { focused: true }, () => {
        sendResponse({ status: 'focused', id: pinnedWindowId });
      });
      return true;
    }
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 360,
      height: 640
    }, (win) => {
      if (chrome.runtime.lastError || !win) {
        sendResponse({ status: 'error' });
        return;
      }
      pinnedWindowId = win.id;
      chrome.runtime.sendMessage({ action: 'pinned_window_created', id: pinnedWindowId });
      sendResponse({ status: 'created', id: pinnedWindowId });
    });
    return true;
  }

  if (msg.action === 'close_pinned_window') {
    if (pinnedWindowId) {
      chrome.windows.remove(pinnedWindowId, () => {
        pinnedWindowId = null;
        chrome.runtime.sendMessage({ action: 'pinned_window_closed' });
        sendResponse({ status: 'closed' });
      });
      return true;
    } else {
      sendResponse({ status: 'none' });
    }
  }

  if (msg.action === 'query_pinned_state') {
    sendResponse({ pinned: !!pinnedWindowId, id: pinnedWindowId });
  }

  if (msg?.action === 'translate_request') {
    // Placeholder translation: echo with language tag.
    const translated = (msg.text || '').split('\n').map(t => `[${msg.target}] ${t}`).join('\n');
    sendResponse({ text: translated });
    return true;
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === pinnedWindowId) {
    pinnedWindowId = null;
    chrome.runtime.sendMessage({ action: 'pinned_window_closed' });
  }
});