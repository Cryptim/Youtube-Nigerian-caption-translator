let pinnedWindowId = null;

// Map of auto-translate tasks per tabId: { intervalId, lastCaption, target }
const autoTranslateTasks = new Map();

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}

function translateViaServer(text, target) {
  // Lightweight copy of popup's translateText behaviour — returns translated text or an error string.
  if (!text) return Promise.resolve('');
  const shortText = (text.length > 800) ? text.slice(-800) : text; // keep reasonably small
  const langName = target || 'target';
  const payload = {
    model: 'local',
    messages: [
      { role: 'system', content: `You are a translation assistant. Translate ONLY the user's text into ${langName}. Output only the translation.` },
      { role: 'user', content: `Translate this to ${langName}: ${shortText}` }
    ],
    max_tokens: 256,
    temperature: 0.1
  };

  const endpoints = ['http://127.0.0.1:8080/v1/chat/completions', 'http://localhost:8080/v1/chat/completions'];

  const attempt = async (url) => {
    try {
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!resp) throw new Error('No response');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      const content = (data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text)) || '';
      return (content && content.trim()) ? content.trim() : `(translation error: empty)`;
    } catch (e) {
      throw e;
    }
  };

  return new Promise(async (resolve) => {
    for (const url of endpoints) {
      try {
        const result = await attempt(url);
        return resolve(result);
      } catch (e) {
        // try next
      }
    }
    resolve('(translation error: Could not reach llama-server)');
  });
}

function ensureContentScriptInTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'ping' }, (resp) => {
      if (!chrome.runtime.lastError && resp && resp.ok) return resolve(true);
      // try to inject content script
      try {
        if (chrome.scripting && chrome.scripting.executeScript) {
          chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, () => {
            // give it a short moment
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: 'ping' }, (r2) => {
                if (!chrome.runtime.lastError && r2 && r2.ok) resolve(true);
                else resolve(false);
              });
            }, 250);
          });
        } else if (chrome.tabs && chrome.tabs.executeScript) {
          chrome.tabs.executeScript(tabId, { file: 'content.js' }, () => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tabId, { action: 'ping' }, (r2) => {
                if (!chrome.runtime.lastError && r2 && r2.ok) resolve(true);
                else resolve(false);
              });
            }, 250);
          });
        } else {
          resolve(false);
        }
      } catch (e) { resolve(false); }
    });
  });
}

async function fetchCaptionFromTab(tabId) {
  return new Promise(async (resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'get_current_caption' }, (resp) => {
        if (!chrome.runtime.lastError && resp && typeof resp.text === 'string') return resolve(resp.text || '');
        // attempt to ensure script and try again
        ensureContentScriptInTab(tabId).then((ok) => {
          if (!ok) return resolve('');
          chrome.tabs.sendMessage(tabId, { action: 'get_current_caption' }, (r2) => {
            if (!chrome.runtime.lastError && r2 && typeof r2.text === 'string') resolve(r2.text || '');
            else resolve('');
          });
        });
      });
    } catch (e) { resolve(''); }
  });
}

function startAutoTranslateForTab(tabId, target) {
  if (!tabId) return false;
  if (autoTranslateTasks.has(tabId)) {
    // update target if needed
    const existing = autoTranslateTasks.get(tabId);
    existing.target = target || existing.target;
    return true;
  }

  let lastCaption = '';
  const tick = async () => {
    try {
      const caption = await fetchCaptionFromTab(tabId);
      if (!caption) return;
      if (caption === lastCaption) return;
      lastCaption = caption;
      const translated = await translateViaServer(caption, target);
      // send overlay update
      try {
        chrome.tabs.sendMessage(tabId, { action: 'overlay_translation', text: translated }, () => {});
      } catch (e) {}
    } catch (e) {}
  };

  // immediate tick then interval
  tick();
  const intervalId = setInterval(tick, 900);
  autoTranslateTasks.set(tabId, { intervalId, lastCaption, target });
  return true;
}

function stopAutoTranslateForTab(tabId) {
  const task = autoTranslateTasks.get(tabId);
  if (task) {
    try { clearInterval(task.intervalId); } catch (e) {}
    autoTranslateTasks.delete(tabId);
    return true;
  }
  return false;
}

// stop tasks when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  stopAutoTranslateForTab(tabId);
});

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
    // Perform translation via local server (attempt) and return result to sender.
    (async () => {
      try {
        const translated = await translateViaServer(msg.text || '', msg.target || 'yo');
        sendResponse({ text: translated });
      } catch (e) {
        sendResponse({ text: '(translation error: background failure)' });
      }
    })();
    return true;
  }

  // Start/stop persistent auto-translation from popup
  if (msg?.action === 'start_auto_translate') {
    // msg.tabId (optional), msg.target
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id) || null;
    if (!tabId) { sendResponse({ status: 'no_tab' }); return true; }
    const ok = startAutoTranslateForTab(tabId, msg.target || 'yo');
    sendResponse({ status: ok ? 'started' : 'failed' });
    return true;
  }

  if (msg?.action === 'stop_auto_translate') {
    const tabId = msg.tabId || (sender && sender.tab && sender.tab.id) || null;
    if (!tabId) { sendResponse({ status: 'no_tab' }); return true; }
    const ok = stopAutoTranslateForTab(tabId);
    sendResponse({ status: ok ? 'stopped' : 'none' });
    return true;
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === pinnedWindowId) {
    pinnedWindowId = null;
    chrome.runtime.sendMessage({ action: 'pinned_window_closed' });
  }
});