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
  return new Promise((resolve) => {
    try {
      chrome.storage && chrome.storage.sync
        ? chrome.storage.sync.get({ preferredLang: DEFAULT_LANG }, res => {
            targetEl.value = res.preferredLang || DEFAULT_LANG;
            resolve();
          })
        : (targetEl.value = DEFAULT_LANG, resolve());
    } catch (e) { targetEl.value = DEFAULT_LANG; resolve(); }
  });
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

// Translate text using Google Translate unofficial endpoint (best-effort).
// Target codes: use LANGS codes (yo, ig, ha). No API key required (unofficial).
async function translateText(text, targetLangCode) {
  if (!text) return '';

  // Try user-configured N-ATLaS endpoint first (stored as `nAtlasEndpoint` in chrome.storage.sync)
  let endpoint = '';
  try {
    endpoint = await new Promise(resolve => {
      try {
        if (chrome && chrome.storage && chrome.storage.sync) {
          chrome.storage.sync.get({ nAtlasEndpoint: '' }, res => resolve(res.nAtlasEndpoint || ''));
        } else {
          resolve('');
        }
      } catch (e) { resolve(''); }
    });
  } catch (e) { endpoint = ''; }

  if (endpoint) {
    try {
      // Small timeout to avoid hanging the popup if endpoint is unreachable
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, target: targetLangCode }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        let out = '';
        if (ct.includes('application/json')) {
          const data = await resp.json();
          // Accept several common shapes: string, { translated }, { translation }, { output }
          if (typeof data === 'string') out = data;
          else out = data.translated || data.translation || data.output || '';
        } else {
          out = await resp.text();
        }
        if (out && out.trim()) return out;
      }
    } catch (e) {
      // endpoint failed -> fall through to fallback translator
      console.warn('N-ATLaS endpoint request failed', e);
    }
  }

  // Fallback: use translate.googleapis.com as a best-effort when no endpoint or it fails
  try {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
                encodeURIComponent(targetLangCode) + '&dt=t&q=' + encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) throw new Error('translate failed');
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('unexpected translate response');
    const sentences = data[0] || [];
    const out = sentences.map(s => s[0]).join('');
    return out;
  } catch (e) {
    console.warn('translate failed', e);
    return ''; // caller will handle fallback
  }
}

// NEW: auto-translate state trackers (keep in module scope)
let autoTranslating = false;
let lastTranslatedSource = '';

async function wireMainUI() {
  const { targetEl, translateBtn, clearBtn, statusEl, liveCaptionOriginalEl, liveCaptionTranslatedEl } = getElements();
  if (!targetEl || !translateBtn || !clearBtn || !statusEl || !liveCaptionOriginalEl || !liveCaptionTranslatedEl) return;

  await populateSelect(targetEl);

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
        liveCaptionOriginalEl.textContent = '';
        liveCaptionTranslatedEl.textContent = '';
        return;
      }
      const caption = await fetchCurrentCaption(tab);
      liveCaptionOriginalEl.textContent = caption || '';
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
    } catch (e) {}
    // clear existing
    if (pollHandle) clearInterval(pollHandle);
    pollHandle = setInterval(async () => {
      try {
        const tab = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, tabs => r(tabs && tabs[0])));
        if (!tab || !isYouTubeVideoUrl(tab.url)) { liveCaptionOriginalEl.textContent = ''; liveCaptionTranslatedEl.textContent = ''; lastTranslatedSource = ''; return; }
        const caption = await fetchCurrentCaption(tab);
        if (caption !== liveCaptionOriginalEl.textContent) {
          liveCaptionOriginalEl.textContent = caption || '';
          // clear translated area when caption updates
          liveCaptionTranslatedEl.textContent = '';
          // reset lastTranslatedSource if caption changed
          if (!caption) lastTranslatedSource = '';
        }
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
      } catch (e) {}
    }, 900);
  }

  function stopPolling() { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }

  startPolling();

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
    } else {
      setStatusEl(statusEl, 'Auto-translation stopped', true);
      lastTranslatedSource = '';
      // optionally clear overlay when stopped? keep overlay; user can Clear Overlay
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

// boot
document.addEventListener('DOMContentLoaded', async () => {
  await wireMainUI();
  const { themeToggle, settingsBtn, cardBody } = getElements();
  initTheme(themeToggle);

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

document.addEventListener('DOMContentLoaded', () => {
  const translateBtn = document.getElementById('translateBtn');
  const clearBtn = document.getElementById('clearBtn');
  const preview = document.getElementById('liveCaptionOriginal');
  const translated = document.getElementById('liveCaptionTranslated');
  const targetLang = document.getElementById('targetLang');

  translateBtn.addEventListener('click', () => {
    getActiveYouTubeTab(tab => {
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'translate_captions', target: targetLang.value }, (resp) => {
        if (resp && resp.text) {
          preview.textContent = resp.text;
          translated.textContent = ""; // If you have translation, set here
        }
      });
    });
  });

  clearBtn.addEventListener('click', () => {
    getActiveYouTubeTab(tab => {
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'clear_overlay' }, () => {
        preview.textContent = '';
        translated.textContent = '';
      });
    });
  });

  // Optionally, poll for live captions every second for real-time updates
  setInterval(() => {
    getActiveYouTubeTab(tab => {
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'get_current_caption' }, (resp) => {
        if (resp && resp.text) {
          preview.textContent = resp.text;
        }
      });
    });
  }, 1000);
});