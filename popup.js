// Popup logic: poll current caption, display it, translate on demand, overlay on video.

const DEFAULT_LANG = 'yo';

const LANGS = [
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' }
];

// fallback sample used when no live caption is available
const SAMPLE_TEXT = `Hello Timothy Ignatius Agbor,

Congratulations!
Your idea, Awarri Media Translator & News Caster has been shortlisted for the next phase of the Awarri Developer Challenge- Build Phase.

Your idea stood out for its creativity, technical potential, and impact and we’re excited to see where you take it from here.

Next Steps: Dec 3rd – Dec 15th, 2025

You are to commence the Build Phase, where you will develop a working prototype powered by N-ATLaS, our multilingual AI model built for Africa.
If you have any questions or need support with the N-ATLaS API, reply to this email, our team is ready to assist you.

Once again, congratulations Timothy Ignatius Agbor. We’re excited to see your innovation come to life.

Warm regards,
Awarri Team`;

function getElements() {
  return {
    targetEl: document.getElementById('targetLang'),
    translateBtn: document.getElementById('translateBtn'),
    clearBtn: document.getElementById('clearBtn'),
    statusEl: document.getElementById('status'),
    liveCaptionOriginalEl: document.getElementById('liveCaptionOriginal'),
    liveCaptionTranslatedEl: document.getElementById('liveCaptionTranslated'),
    settingsBtn: document.getElementById('settingsBtn'),
    cardBody: document.querySelector('.card-body'),
    themeToggle: document.getElementById('themeToggle')
  };
}

function setStatusEl(statusEl, text, transient = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (transient) setTimeout(()=>{ statusEl.textContent = 'Ready'; }, 3000);
}

function populateSelect(targetEl) {
  if (!targetEl) return Promise.resolve();
  targetEl.innerHTML = '';
  LANGS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    targetEl.appendChild(opt);
  });
  // leave selection to caller; populateSelect only builds options
  return Promise.resolve();
}

// Read preferred language reliably from chrome.storage.sync, then chrome.storage.local, then localStorage
async function readPreferredLang() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      if (chrome.storage.sync && chrome.storage.sync.get) {
        try {
          const res = await new Promise(r => chrome.storage.sync.get({ preferredLang: DEFAULT_LANG }, r));
          if (res && res.preferredLang) return res.preferredLang;
        } catch (e) {}
      }
      if (chrome.storage.local && chrome.storage.local.get) {
        try {
          const res2 = await new Promise(r => chrome.storage.local.get({ preferredLang: DEFAULT_LANG }, r));
          if (res2 && res2.preferredLang) return res2.preferredLang;
        } catch (e) {}
      }
    }
  } catch (e) {}
  try { return localStorage.getItem('preferredLang') || DEFAULT_LANG; } catch (e) { return DEFAULT_LANG; }
}

// Messaging helpers
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (resp) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(resp);
      });
    } catch (err) { reject(err); }
  });
}

function executeScriptInTab(tabId, file) {
  return new Promise((resolve, reject) => {
    if (chrome.scripting && chrome.scripting.executeScript) {
      chrome.scripting.executeScript({ target: { tabId }, files: [file] }, (results) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(results);
      });
    } else if (chrome.tabs && chrome.tabs.executeScript) {
      chrome.tabs.executeScript(tabId, { file }, (res) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    } else reject(new Error('No scripting API'));
  });
}

function isYouTubeVideoUrl(url = '') {
  try { if (!url) return false; const u = url.toLowerCase(); return u.includes('youtube.com/watch') || u.includes('youtu.be/'); } catch(e){ return false; }
}

async function ensureContentScript(tab) {
  // probe
  try {
    await sendMessageToTab(tab.id, { action: 'ping' });
    return true;
  } catch (e) {
    // try inject
  }
  try {
    await executeScriptInTab(tab.id, 'content.js');
    // give script a moment
    await new Promise(r=>setTimeout(r, 250));
    // probe again
    await sendMessageToTab(tab.id, { action: 'ping' });
    return true;
  } catch (e) {
    return false;
  }
}

// Request the current caption text from the active tab
async function fetchCurrentCaption(tab) {
  try {
    const ok = await ensureContentScript(tab);
    if (!ok) return '';
    const resp = await sendMessageToTab(tab.id, { action: 'get_current_caption' });
    return (resp && resp.text) ? resp.text : '';
  } catch (e) {
    return '';
  }
}

// Add simple code-to-name map for target language
const LANG_NAME_MAP = { yo: 'Yoruba', ig: 'Igbo', ha: 'Hausa' };

// helper: pick a concise sentence from caption for translation
function pickShortSentence(text, maxLen = 300) {
  if (!text) return '';
  // split into sentences by punctuation, prefer last complete sentence
  const parts = text.split(/(?<=[.?!])\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = parts[i].trim();
    if (s.length > 0 && s.length <= maxLen) return s;
  }
  // fallback: trim whole text to maxLen, prefer end (use last maxLen chars)
  if (text.length <= maxLen) return text.trim();
  return text.slice(-maxLen).trim();
}

// Translate text using local llama-server (OpenAI-compatible local endpoint — not OpenAI cloud).
async function translateText(text, targetLangCode) {
  if (!text) return '';
  // pick concise sentence to avoid long generation and reduce timeout risk
  const shortText = pickShortSentence(text, 300);

  // Add a timeout to the fetch request
  const controller = new AbortController();
  const baseTimeoutMs = 30000; // 30 seconds
  let timeoutHandle = setTimeout(() => controller.abort(), baseTimeoutMs);

  const langName = LANG_NAME_MAP[targetLangCode] || targetLangCode;
  const payload = {
    model: "local",
    messages: [
      { role: "system", content: `You are a translation assistant. Translate ONLY the user's text into ${langName}. Output only the translation.` },
      { role: "user", content: `Translate this to ${langName}: ${shortText}` }
    ],
    max_tokens: 128,
    temperature: 0.1
  };

  async function doRequest(signal) {
    try {
      let resp = await fetch('http://127.0.0.1:8080/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });
      if (!resp.ok) {
        resp = await fetch('http://localhost:8080/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal
        });
      }
      return resp;
    } catch (e) {
      throw e;
    }
  }

  try {
    setStatusEl(getElements().statusEl, 'Translating…');
    const resp = await doRequest(controller.signal);
    clearTimeout(timeoutHandle);

    if (resp && resp.ok) {
      const data = await resp.json();
      const content = (data && data.choices && data.choices[0] && (data.choices[0].message?.content || data.choices[0].text)) || '';
      if (!content || !content.trim()) {
        setStatusEl(getElements().statusEl, 'Translation returned empty result', true);
        return '(translation error: No translation returned)';
      }
      setStatusEl(getElements().statusEl, 'Translation complete', true);
      return content.trim();
    } else if (resp) {
      const errText = await resp.text();
      setStatusEl(getElements().statusEl, `llama-server HTTP ${resp.status}`, true);
      return `(translation error: HTTP ${resp.status})`;
    } else {
      setStatusEl(getElements().statusEl, 'No response from llama-server', true);
      return '(translation error: No response from llama-server)';
    }
  } catch (e) {
    clearTimeout(timeoutHandle);
    // If aborted due to timeout, retry once with a longer timeout
    if (e.name === 'AbortError' || (e.message && e.message.toLowerCase().includes('failed to fetch'))) {
      setStatusEl(getElements().statusEl, 'Translation timed out — retrying...', true);
      // reset lastTranslatedSource so next poll will attempt again
      try { lastTranslatedSource = ''; } catch (err) {}
      // retry with longer timeout
      const retryController = new AbortController();
      const retryTimeout = setTimeout(() => retryController.abort(), baseTimeoutMs * 1.5); // 45s
      try {
        const resp2 = await doRequest(retryController.signal);
        clearTimeout(retryTimeout);
        if (resp2 && resp2.ok) {
          const data2 = await resp2.json();
          const content2 = (data2 && data2.choices && data2.choices[0] && (data2.choices[0].message?.content || data2.choices[0].text)) || '';
          if (content2 && content2.trim()) {
            setStatusEl(getElements().statusEl, 'Translation complete (after retry)', true);
            return content2.trim();
          } else {
            setStatusEl(getElements().statusEl, 'Translation returned empty result', true);
            return '(translation error: No translation returned)';
          }
        } else if (resp2) {
          const errText2 = await resp2.text();
          setStatusEl(getElements().statusEl, `llama-server HTTP ${resp2.status}`, true);
          return `(translation error: HTTP ${resp2.status})`;
        } else {
          setStatusEl(getElements().statusEl, 'No response from llama-server (retry)', true);
          return '(translation error: No response from llama-server)';
        }
      } catch (retryErr) {
        clearTimeout(retryTimeout);
        setStatusEl(getElements().statusEl, 'Translation retry failed (timed out)', true);
        try { lastTranslatedSource = ''; } catch (err) {}
        return '(translation error: Timed out)';
      }
    }
    setStatusEl(getElements().statusEl, 'Could not reach llama-server. Is it running?', true);
    return '(translation error: Could not reach llama-server. Start llama-server on port 8080.)';
  }
}

// NEW: auto-translate state trackers (keep in module scope)
let autoTranslating = false;
let lastTranslatedSource = '';

async function wireMainUI() {
  const { targetEl, translateBtn, clearBtn, statusEl, liveCaptionOriginalEl, liveCaptionTranslatedEl } = getElements();
  if (!targetEl || !translateBtn || !clearBtn || !statusEl || !liveCaptionOriginalEl || !liveCaptionTranslatedEl) return;

  await populateSelect(targetEl);
  // read preferred language (chrome.storage or localStorage) and reflect it
  try {
    const pref = await readPreferredLang();
    if (pref && targetEl) targetEl.value = pref;
  } catch (e) {}

  // update active language badge if present
  try {
    const badge = document.getElementById('activeLangBadge');
    if (badge) {
      const cur = (targetEl && targetEl.value) ? targetEl.value : DEFAULT_LANG;
      badge.textContent = LANG_NAME_MAP[cur] || cur;
    }
  } catch (e) {}

  // When user changes the target language: persist and trigger immediate translation
  try {
    if (targetEl) {
      targetEl.addEventListener('change', async (ev) => {
        const newLang = (ev && ev.target && ev.target.value) ? ev.target.value : (targetEl.value || DEFAULT_LANG);
        // persist preference: try chrome.storage.sync, then local, then localStorage

        try {
          if (typeof chrome !== 'undefined' && chrome.storage) {
            try { chrome.storage.sync && chrome.storage.sync.set && chrome.storage.sync.set({ preferredLang: newLang }); } catch (e) {}
            try { chrome.storage.local && chrome.storage.local.set && chrome.storage.local.set({ preferredLang: newLang }); } catch (e) {}
          }
        } catch (e) {}
        try { localStorage.setItem('preferredLang', newLang); } catch (e) {}

        // update status, badge and show a short toast confirming save
        try { setStatusEl(statusEl, `Target language set to ${LANG_NAME_MAP[newLang] || newLang}` , true); } catch (e) {}
        try {
          const badge = document.getElementById('activeLangBadge');
          if (badge) badge.textContent = LANG_NAME_MAP[newLang] || newLang;
        } catch (e) {}
        try {
          const toast = document.getElementById('popupToast');
          if (toast) {
            toast.textContent = `Language saved: ${LANG_NAME_MAP[newLang] || newLang}`;
            toast.style.display = 'block';
            toast.setAttribute('aria-hidden', 'false');
            setTimeout(() => { try { toast.style.display = 'none'; toast.setAttribute('aria-hidden','true'); } catch (e) {} }, 2200);
          }
        } catch (e) {}

        // force next caption to be translated immediately
        try { lastTranslatedSource = ''; } catch (e) {}

        // If autoTranslating is active, trigger an immediate translation for the active tab
        if (autoTranslating) {
          try {
            const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
            if (tab && isYouTubeVideoUrl(tab.url)) {
              const caption = await fetchCurrentCaption(tab);
              if (caption) {
                // Show translating placeholder
                try { liveCaptionTranslatedEl.textContent = 'Translating…'; } catch (e) {}
                const translated = await translateText(caption, newLang);
                if (translated) {
                  try { liveCaptionTranslatedEl.textContent = translated; } catch (e) {}
                  try {
                    await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated });
                  } catch (e) {
                    const ok = await ensureContentScript(tab);
                    if (ok) {
                      try { await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated }); } catch (err) {}
                    }
                  }
                }
              }
            }
          } catch (e) {}
        }
      });
    }
  } catch (e) {}

  // remove old handlers
  const tClone = translateBtn.cloneNode(true);
  translateBtn.parentNode.replaceChild(tClone, translateBtn);
  const cClone = clearBtn.cloneNode(true);
  clearBtn.parentNode.replaceChild(cClone, clearBtn);

  const newTranslate = document.getElementById('translateBtn');
  const newClear = document.getElementById('clearBtn');

  // Poll active tab for captions periodically while popup open
  let pollHandle = null;
  async function startPolling() {
    // one immediate fetch then interval
    try {
      const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
      if (!tab || !isYouTubeVideoUrl(tab.url)) {
        liveCaptionOriginalEl.textContent = 'No YouTube video detected.';
        liveCaptionTranslatedEl.textContent = '';
        return;
      }
      const caption = await fetchCurrentCaption(tab);
      liveCaptionOriginalEl.textContent = caption || '(No captions detected)';
      if (!caption) {
        liveCaptionTranslatedEl.textContent = '';
        lastTranslatedSource = '';
      } else if (autoTranslating && caption && caption !== lastTranslatedSource) {
        // perform automatic translation for new caption
        lastTranslatedSource = caption;
        liveCaptionTranslatedEl.textContent = 'Translating…';
        const target = (document.getElementById('targetLang') || {}).value || DEFAULT_LANG;
        try {
          const translated = await translateText(caption, target);
          if (translated) {
            liveCaptionTranslatedEl.textContent = translated;
            setStatusEl(statusEl, 'Auto-translation updated', true);
            // overlay on video
            try {
              await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated });
            } catch (e) {
              const ok = await ensureContentScript(tab);
              if (ok) {
                try { await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated }); } catch(e){}
              }
            }
          } else {
            liveCaptionTranslatedEl.textContent = '(translation failed)';
          }
        } catch (e) {
          liveCaptionTranslatedEl.textContent = '(translation error)';
        }
      }
    } catch (e) {
      liveCaptionOriginalEl.textContent = '(Error fetching captions)';
    }
    // clear existing
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(async () => {
      try {
        const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
        if (!tab || !isYouTubeVideoUrl(tab.url)) {
          liveCaptionOriginalEl.textContent = 'No YouTube video detected.';
          liveCaptionTranslatedEl.textContent = '';
          lastTranslatedSource = '';
          return;
        }
        const caption = await fetchCurrentCaption(tab);
        liveCaptionOriginalEl.textContent = caption || '(No captions detected)';
        // if auto translating and caption present and new relative to lastTranslatedSource -> translate
        if (autoTranslating && caption && caption !== lastTranslatedSource) {
          lastTranslatedSource = caption;
          liveCaptionTranslatedEl.textContent = 'Translating…';
          const target = (document.getElementById('targetLang') || {}).value || DEFAULT_LANG;
          try {
            const translated = await translateText(caption, target);
            if (translated) {
              liveCaptionTranslatedEl.textContent = translated;
              setStatusEl(statusEl, 'Auto-translation updated', true);
              try {
                await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated });
              } catch (e) {
                const ok = await ensureContentScript(tab);
                if (ok) {
                  try { await sendMessageToTab(tab.id, { action: 'overlay_translation', text: translated }); } catch(e){}
                }
              }
            } else {
              liveCaptionTranslatedEl.textContent = '(translation failed)';
            }
          } catch (e) {
            liveCaptionTranslatedEl.textContent = '(translation error)';
          }
        }
      } catch (e) {
        liveCaptionOriginalEl.textContent = '(Error fetching captions)';
      }
    }, 900);
  }

  function stopPolling() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }

  // Start auto-translation immediately using saved language if available
  try {
    // default to starting auto translation
    autoTranslating = true;
    if (newTranslate) {
      newTranslate.textContent = 'Stop Translating';
      newTranslate.setAttribute('aria-pressed', 'true');
    }
    const prefCode = (targetEl && targetEl.value) || DEFAULT_LANG;
    const prefName = LANG_NAME_MAP[prefCode] || prefCode;
    setStatusEl(statusEl, `Auto-translation started (${prefName})`, true);
  } catch (e) {}
  // Begin polling (this will perform an immediate fetch & translation)
  startPolling();

  // Request background to start persistent auto-translation for the active tab
  (async function startBg() {
    try {
      const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
      const tab = tabs && tabs[0];
      if (!tab) return;
      const target = (targetEl && targetEl.value) || DEFAULT_LANG;
      try { chrome.runtime.sendMessage({ action: 'start_auto_translate', tabId: tab.id, target }); } catch (e) {}
    } catch (e) {}
  })();

  // Translate button toggles auto-translation
  newTranslate.addEventListener('click', async () => {
    autoTranslating = !autoTranslating;
    // update button label/aria
    newTranslate.textContent = autoTranslating ? 'Stop Translating' : 'Start Translating';
    newTranslate.setAttribute('aria-pressed', autoTranslating ? 'true' : 'false');
    if (autoTranslating) {
      setStatusEl(statusEl, 'Auto-translation started', true);
      // trigger immediate translation for current caption if present
      const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
      if (tab && isYouTubeVideoUrl(tab.url)) {
        const caption = await fetchCurrentCaption(tab);
        if (caption) {
          lastTranslatedSource = ''; // force translate
        }
      }
      // tell background to start persistent auto-translate for this tab
      try {
        const tabs2 = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        const tab2 = tabs2 && tabs2[0];
        const target = (document.getElementById('targetLang') || {}).value || DEFAULT_LANG;
        if (tab2) chrome.runtime.sendMessage({ action: 'start_auto_translate', tabId: tab2.id, target });
      } catch (e) {}
    } else {
      setStatusEl(statusEl, 'Auto-translation stopped', true);
      lastTranslatedSource = '';
      // optionally clear overlay when stopped? keep overlay; user can Clear Overlay
      // tell background to stop persistent auto-translate for this tab
      try {
        const tabs2 = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
        const tab2 = tabs2 && tabs2[0];
        if (tab2) chrome.runtime.sendMessage({ action: 'stop_auto_translate', tabId: tab2.id });
      } catch (e) {}
    }
  });

  newClear.addEventListener('click', async () => {
    // stopping auto-translate when user clears
    if (autoTranslating) {
      autoTranslating = false;
      const btn = document.getElementById('translateBtn');
      if (btn) { btn.textContent = 'Start Translating'; btn.setAttribute('aria-pressed', 'false'); }
      lastTranslatedSource = '';
    }

    setStatusEl(statusEl, 'Clearing overlay…');
    try {
      const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
      if (!tab) { setStatusEl(statusEl, 'No active tab', true); return; }
      try {
        await sendMessageToTab(tab.id, { action: 'clear_overlay' });
        // also stop background auto-translate for this tab
        try { chrome.runtime.sendMessage({ action: 'stop_auto_translate', tabId: tab.id }); } catch (e) {}
        setStatusEl(statusEl, 'Overlay cleared', true);
        const cap = await fetchCurrentCaption(tab);
        liveCaptionOriginalEl.textContent = cap || '';
        liveCaptionTranslatedEl.textContent = '';
      } catch (e) {
        setStatusEl(statusEl, 'No overlay to clear', true);
      }
    } catch (e) {
      setStatusEl(statusEl, 'Failed to clear overlay', true);
    }
  });

  // Stop polling when popup closes (attempt)
  window.addEventListener('unload', () => stopPolling());
}

function initTheme(themeToggle) {
  const THEME_KEY = 'yt_nigerian_theme';
  if (!themeToggle) return;
  function applyTheme(t) {
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
      themeToggle.setAttribute('aria-pressed', 'true');
      themeToggle.title = 'Switch to light theme';
    } else {
      document.documentElement.classList.remove('dark');
      themeToggle.setAttribute('aria-pressed', 'false');
      themeToggle.title = 'Switch to dark theme';
    }
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }
  const saved = (function () { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })() || 'light';
  applyTheme(saved);
  themeToggle.addEventListener('click', () => {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
    applyTheme(next);
  });
}

// Check if llama-server is running locally
async function checkLlamaServer(statusEl) {
  try {
    const resp = await fetch('http://127.0.0.1:8080/v1/models', { method: 'GET' });
    if (resp.ok) {
      setStatusEl(statusEl, 'llama-server running');
      return true;
    }
    setStatusEl(statusEl, 'llama-server not responding', true);
    return false;
  } catch (e) {
    setStatusEl(statusEl, 'llama-server not running', true);
    return false;
  }
}

// boot
document.addEventListener('DOMContentLoaded', async () => {
  await wireMainUI();
  const { themeToggle, settingsBtn, cardBody, statusEl } = getElements();
  initTheme(themeToggle);

  // Remove Flask ping — check llama-server directly
  checkLlamaServer(statusEl);

  // settings handling unchanged (in-popup injection/back button logic can remain)
  if (!settingsBtn || !cardBody) return;

  let originalBodyHTML = cardBody.innerHTML;
  let inSettings = false;

  async function openSettingsInPopup() {
    if (inSettings) return;
    inSettings = true;
    try {
      const resp = await fetch('options.html', { cache: 'no-store' });
      if (!resp.ok) throw new Error('Failed to load options');
      const text = await resp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const optionsContent = doc.querySelector('body') ? doc.querySelector('body').innerHTML : text;
      const backBtnHtml = `
        <div class="settings-injected-header">
          <button id="settingsBack" class="btn outline settings-back" aria-label="Back to main">
            <span class="back-arrow">←</span><span class="back-label">Back</span>
          </button>
          <div class="settings-title">Settings</div>
        </div>
      `;
      cardBody.innerHTML = backBtnHtml + optionsContent;
      const backBtn = document.getElementById('settingsBack');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          cardBody.innerHTML = originalBodyHTML;
          inSettings = false;
          setTimeout(() => wireMainUI(), 0);
        });
      }
    } catch (err) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        } else if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.openOptionsPage) {
          browser.runtime.openOptionsPage();
        } else {
          window.open('options.html', '_blank', 'noopener');
        }
      } catch (e) {
        window.open('options.html', '_blank', 'noopener');
      }
      inSettings = false;
    }
  }

  settingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openSettingsInPopup();
  });
});

function getActiveYouTubeTab(callback) {
  chrome.tabs.query({ url: '*://www.youtube.com/*', active: true }, tabs => {
    if (tabs && tabs.length) {
      callback(tabs[0]);
    } else {
      // fallback: get any active tab in current window
      chrome.tabs.query({ active: true, currentWindow: true }, tabs2 => {
        callback(tabs2 && tabs2.length ? tabs2[0] : null);
      });
    }
  });
}

// Add pin button behavior without disturbing other popup logic
document.addEventListener('DOMContentLoaded', () => {
  const pinBtn = document.getElementById('pinBtn');
  if (!pinBtn) return;
  let pinned = false;

  function setPinnedState(state) {
    pinned = !!state;
    pinBtn.classList.toggle('pinned', pinned);
    pinBtn.setAttribute('aria-pressed', String(pinned));
    pinBtn.title = pinned ? 'Unpin (close pinned window)' : 'Pin popup (keep open)';
  }

  pinBtn.addEventListener('click', () => {
    if (!pinned) {
      chrome.runtime.sendMessage({ action: 'create_pinned_window' }, (resp) => {
        if (resp && (resp.status === 'created' || resp.status === 'focused')) setPinnedState(true);
      });
      // Close the current popup so only the new persistent window remains
      window.close();
    } else {
      chrome.runtime.sendMessage({ action: 'close_pinned_window' }, (resp) => {
        setPinnedState(false);
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.action) return;
    if (msg.action === 'pinned_window_created') setPinnedState(true);
    if (msg.action === 'pinned_window_closed') setPinnedState(false);
  });

  chrome.runtime.sendMessage({ action: 'query_pinned_state' }, (resp) => {
    if (resp && resp.pinned) setPinnedState(true);
    else setPinnedState(false);
  });
});

// Note: translate/clear button behaviors are wired in `wireMainUI()` when the popup initializes.