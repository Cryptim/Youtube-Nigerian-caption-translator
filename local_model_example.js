// Minimal local translate server for testing. Requires Node 18+ (fetch available).
// Run: node local_model_example.js
import express from 'express';

const app = express();
app.use(express.json());

const LIBRE_URL = 'http://127.0.0.1:5000/translate'; // optional local LibreTranslate
const PORT = 8000; // must match LOCAL_TRANSLATE_URL in content.js

app.post('/translate', async (req, res) => {
  const { text, target } = req.body || {};
  if (!text) return res.status(400).json({ error: 'No text' });

  // Try LibreTranslate if available
  try {
    const resp = await fetch(LIBRE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: 'auto', target: target || 'en', format: 'text' }),
      // no signal/timeout for brevity
    });
    if (resp.ok) {
      const j = await resp.json();
      // LibreTranslate returns { translatedText: "..." }
      const out = (j && (j.translatedText || j.translation)) ? (j.translatedText || j.translation) : null;
      if (out) return res.json({ text: out });
    }
  } catch (e) {
    // fallthrough to fallback translator
  }

  // Fallback simple "local" transformation (for testing only)
  const fallback = `[local fallback -> ${target || 'en'}] ${text}`;
  return res.json({ text: fallback });
});

app.listen(PORT, () => {
  console.log(`Local translate server listening on http://127.0.0.1:${PORT}/translate`);
  console.log('Will try LibreTranslate at http://127.0.0.1:5000/translate, otherwise return fallback text.');
});
