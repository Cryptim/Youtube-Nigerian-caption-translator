// Service worker: handles translations (placeholder) and future API calls.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === 'translate_request') {
    // Placeholder translation: echo with language tag.
    const translated = (msg.text || '').split('\n').map(t => `[${msg.target}] ${t}`).join('\n');
    sendResponse({ text: translated });
    return true;
  }
});