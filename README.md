
---

# 🎬 YouTube Caption Translator (Powered by Awarri NTAtlas)

![YouTube Caption Translator](assets/image.png)

The **YouTube Caption Translator** is a Chrome extension that automatically translates YouTube video captions into a user’s **native language** using the **Awarri NTAtlas language model**. It enhances accessibility and enables multilingual understanding for users across the globe.

---

## 🚀 Features

* 🧩 Detects captions from any YouTube video
* 🌐 Translates captions using Awarri’s NTAtlas language model
* 💬 Displays translated text as live overlay on YouTube videos
* ⚙️ Simple browser extension setup
* 🎨 Clean UI via popup and toolbar integration

---

## 🧭 System Flow

The high-level process flow is illustrated below:

1. User opens YouTube
2. The **YouTube Caption Translator** extension activates
3. Captions are detected via YouTube’s DOM or API
4. User selects target language (e.g., Yoruba, Hausa, Igbo, Swahili, etc.)
5. Captions are sent to **Awarri’s NTAtlas model**
6. Translated text is received and rendered as subtitles
7. Translated captions appear in real-time on the video

📊 The system flow diagram can be viewed in:

![System Flow](assets/flowchart.svg)

---

## 🧱 Project Structure

```text
youtube-caption-translator/
├── flowchart.drawio         # Editable diagram (inside VS Code)
├── assets/
│   └── flowchart.png        # Exported visual version
├── manifest.json            # Chrome extension manifest (v3)
├── background.js            # Handles background events and API logic
├── content.js               # Injected into YouTube pages
├── popup/
│   ├── popup.html           # Extension popup interface
│   ├── popup.js             # Popup functionality and event handling
│   └── popup.css            # Styling for popup interface
└── scripts/
    ├── translator.js        # Handles NTAtlas API translation requests
    └── captions.js          # Extracts and synchronizes YouTube captions
```

---

## 🧩 Technologies Used

* **JavaScript (ES6+)**
* **Chrome Extension API (Manifest V3)**
* **Awarri NTAtlas Language Model API**
* **HTML5 / CSS3**
* **Draw.io (System Flow Diagram)**
* **VS Code**

---

## ⚙️ Setup Instructions

1. Clone this repository:

```bash
git clone https://github.com/Cryptim/Youtube-Nigerian-caption-translator.git
```

2. Open in VS Code:

```bash
code youtube-caption-translator
```

3. Load the extension in Chrome:

* Go to `chrome://extensions/`
* Enable **Developer Mode**
* Click **Load unpacked**
* Select the `youtube-caption-translator` folder

4. Test on a YouTube video with captions enabled.

---

## 🔗 API Integration (Awarri NTAtlas)

To connect to the NTAtlas model:

* Obtain an API key from [Awarri Developer Portal](https://developer.awarri.com)
* Add it to your environment configuration inside `translator.js`
* Example snippet:

```javascript
const API_KEY = "YOUR_AWARRI_NTATLAS_KEY";
```

---

## 🧑‍💻 Contributors

* **Your Name** — Developer
* **Awarri AI Team** — Language model provider

---

## 📜 License

This project is licensed under the [MIT License](LICENSE).

---

### ✅ Key Fixes Applied

1. All images now use **forward slashes** (`/`) so GitHub can render them.
2. Folder tree wrapped in ` ```text ` and uses **spaces** for indentation.
3. Triple backticks fixed for all code blocks (no extra backticks).
4. Horizontal rules `---` have spacing above and below for proper rendering.
5. Placeholder link replaced with the real [Awarri Developer Portal](https://developer.awarri.com).

---

