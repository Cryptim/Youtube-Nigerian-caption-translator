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
    let feedbackEl = el('copyFeedback');
    if (!feedbackEl) {
      feedbackEl = document.createElement('span');
      feedbackEl.id = 'copyFeedback';
      feedbackEl.className = 'copy-feedback';
      copyBtn.insertAdjacentElement('afterend', feedbackEl);
    }
    copyBtn.addEventListener('click', async () => {
      const cmd = el('runCmd').textContent;
      // try Clipboard API first
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(cmd);
        } else {
          // fallback: use temporary textarea
          const ta = document.createElement('textarea');
          ta.value = cmd;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        if (feedbackEl) {
          feedbackEl.style.color = '#10b981';
          feedbackEl.textContent = 'Copied!';
          console.log('Options: copied run command');
          setTimeout(() => { try { feedbackEl.textContent = ''; } catch(e){} }, 2200);
        } else {
          alert('Command copied');
        }
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.style.color = '#ef4444';
          feedbackEl.textContent = 'Copy failed — select and copy';
          console.error('Options: copy failed', err);
          setTimeout(() => { try { feedbackEl.textContent = ''; } catch(e){} }, 3600);
        } else {
          alert('Copy failed — manually select and copy');
        }
      }
    });
  }
});