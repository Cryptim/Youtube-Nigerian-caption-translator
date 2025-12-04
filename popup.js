// Minimal, robust UI logic that uses chrome.storage and runtime messaging.
function getElements() {
  return {
    targetEl: document.getElementById('targetLang'),
    translateBtn: document.getElementById('translateBtn'),
    clearBtn: document.getElementById('clearBtn'),
    statusEl: document.getElementById('status')
  };
}

function setStatusEl(statusEl, text, transient = false) {
  if (!statusEl) return;
  statusEl.textContent = text;
  if (transient) setTimeout(()=>{ statusEl.textContent = 'Ready' }, 3000);
}

function populateSelect(targetEl) {
  if (!targetEl) return;
  targetEl.innerHTML = ''; // ensure fresh
  LANGS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    targetEl.appendChild(opt);
  });
  try {
    chrome.storage.sync.get({ preferredLang: DEFAULT_LANG }, res => {
      targetEl.value = res.preferredLang || DEFAULT_LANG;
    });
  } catch (e) {
    targetEl.value = DEFAULT_LANG;
  }
}

// central wiring for main UI — can be called after restoring original HTML
function wireMainUI() {
  const { targetEl, translateBtn, clearBtn, statusEl } = getElements();
  if (!targetEl || !translateBtn || !clearBtn || !statusEl) return;

  populateSelect(targetEl);

  // remove any existing handlers to avoid duplicates
  translateBtn.replaceWith(translateBtn.cloneNode(true));
  clearBtn.replaceWith(clearBtn.cloneNode(true));

  const newTranslate = document.getElementById('translateBtn');
  const newClear = document.getElementById('clearBtn');

  newTranslate.addEventListener('click', async () => {
    const target = (document.getElementById('targetLang') || {}).value || DEFAULT_LANG;
    try { chrome.storage.sync.set({ preferredLang: target }); } catch (e) {}
    setStatusEl(statusEl, 'Requesting captions and translating…');
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) { setStatusEl(statusEl, 'No active tab', true); return; }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'translate_captions', target }, resp => {
        if (chrome.runtime.lastError) {
          setStatusEl(statusEl, 'Content script not loaded. Please open a YouTube video.', true);
        } else {
          setStatusEl(statusEl, resp?.status || 'Translation complete', true);
        }
      });
    });
  });

  newClear.addEventListener('click', () => {
    setStatusEl(statusEl, 'Clearing overlay…');
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) { setStatusEl(statusEl, 'No active tab', true); return; }
      chrome.tabs.sendMessage(tabs[0].id, { action: 'clear_overlay' }, resp => {
        setStatusEl(statusEl, resp?.status || 'Overlay cleared', true);
      });
    });
  });
}

const DEFAULT_LANG = 'en';

const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'pcm', name: 'Nigerian Pidgin' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' }
];

function setStatus(text, transient = false) {
  statusEl.textContent = text;
  if (transient) setTimeout(()=>{ statusEl.textContent = 'Ready' }, 3000);
}

function populate() {
  LANGS.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    targetEl.appendChild(opt);
  });
  chrome.storage.sync.get({ preferredLang: DEFAULT_LANG }, res => {
    targetEl.value = res.preferredLang || DEFAULT_LANG;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const THEME_KEY = 'yt_nigerian_theme';
  const themeToggle = document.getElementById('themeToggle');

  if (themeToggle) {
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

  // ensure main UI wired on load
  wireMainUI();

  // NEW: in-popup settings loader (keeps popup size unchanged)
  const settingsBtn = document.getElementById('settingsBtn');
  const cardBody = document.querySelector('.card-body');
  if (settingsBtn && cardBody) {
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

        // Inject a clean header with back button (uses class names that match CSS)
        const backBtnHtml = `
          <div class="settings-injected-header">
            <button id="settingsBack" class="btn outline settings-back" aria-label="Back to main">
              <span class="back-arrow">←</span>
              <span class="back-label">Back</span>
            </button>
            <div class="settings-title">Settings</div>
          </div>
        `;

        cardBody.innerHTML = backBtnHtml + optionsContent;

        // Attach back handler that restores UI and re-wires main UI
        const backBtn = document.getElementById('settingsBack');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            cardBody.innerHTML = originalBodyHTML;
            inSettings = false;
            // re-wire main UI after DOM replacement
            setTimeout(() => wireMainUI(), 0);
          });
        }

        // Optionally, limit injected content height to keep popup size sensible
      } catch (err) {
        // fallback: open options page externally if in-popup load fails
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
  }

  // ...existing code (other handlers) ...
});