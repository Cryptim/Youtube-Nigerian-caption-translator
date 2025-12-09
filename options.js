const LANGS = [
  { code: 'yo', name: 'Yoruba' },
  { code: 'ig', name: 'Igbo' },
  { code: 'ha', name: 'Hausa' }
];

function el(id){ return document.getElementById(id); }

function setStatus(text, ok){
  let st = el('llamaStatus');
  if (!st) {
    st = document.createElement('div');
    st.id = 'llamaStatus';
    st.style.marginTop = '8px';
    st.style.fontWeight = '600';
    document.getElementById('statusContainer').appendChild(st);
  }
  st.textContent = text;
  st.style.color = ok ? '#10b981' : '#ef4444';
}

async function checkLlamaServer(){
  setStatus('checking…', false);
  try {
    const resp = await fetch('http://127.0.0.1:8080/v1/models', { method: 'GET' });
    if (resp.ok) {
      setStatus('llama-server running', true);
      return true;
    } else {
      setStatus(`llama-server responded HTTP ${resp.status}`, false);
      return false;
    }
  } catch (e) {
    setStatus('llama-server not running', false);
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // initial check and UI wiring
  await checkLlamaServer();

  // allow re-check by clicking status
  const st = el('llamaStatus');
  if (st) {
    st.style.cursor = 'pointer';
    st.title = 'Click to re-check llama-server';
    st.addEventListener('click', () => checkLlamaServer());
  }

  // copy run command button
  const copyBtn = el('copyCmd');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const cmd = el('runCmd').textContent;
      try { await navigator.clipboard.writeText(cmd); alert('Command copied'); } catch { alert('Copy failed — manually select and copy'); }
    });
  }
});