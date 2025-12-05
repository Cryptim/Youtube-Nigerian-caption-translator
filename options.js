const LANGS = [
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' }
];
const apiKeyEl = document.getElementById('apiKey');
const defaultLangEl = document.getElementById('defaultLang');
const saveBtn = document.getElementById('saveBtn');

LANGS.forEach(l => {
  const o = document.createElement('option'); o.value = l.code; o.textContent = l.name;
  defaultLangEl.appendChild(o);
});

chrome.storage.sync.get({ apiKey: '', preferredLang: 'en' }, res => {
  apiKeyEl.value = res.apiKey || '';
  defaultLangEl.value = res.preferredLang || 'en';
});

saveBtn.addEventListener('click', () => {
  chrome.storage.sync.set({ apiKey: apiKeyEl.value.trim(), preferredLang: defaultLangEl.value }, () => {
    saveBtn.textContent = 'Saved';
    setTimeout(()=> saveBtn.textContent = 'Save', 1500);
  });
});