# ⚡ LinkedIn Automation Suite

This folder contains all automated tools, profiles, and browser extensions for **LinkedIn** within the **Automate Jobs** ecosystem.

---

## 📁 Directory Structure

```
Automate Jobs/
└── LinkedIn/
    ├── README.md               # Main LinkedIn automation suite documentation
    ├── data/
    │   └── default_profile.json# Master default profile and Q&A bank data
    └── Extension/              # Chrome & Brave Manifest V3 Auto-Apply Extension
        ├── manifest.json
        ├── README.md           # Extension user guide & installation steps
        ├── data/
        │   └── default_profile.json
        ├── popup/
        │   ├── popup.html
        │   ├── popup.css
        │   └── popup.js
        └── scripts/
            ├── matcher.js
            ├── linkedin_search.js
            ├── linkedin_easy_apply.js
            ├── background.js
            └── content.css
```

---

## 🚀 Components

### 1. **LinkedIn SpeedFill Extension (`./Extension`)**
- High-performance Chrome & Brave extension for **LinkedIn Easy Apply** applications and **LinkedIn Job Search results**.
- Automates field filling, radio choices, dropdown comboboxes, resume auto-picker, step auto-advancement, and auto-submission.
- Features sub-10ms local fuzzy field matching and interactive search results queue pill.

### 2. **Master Profile Data (`./data/default_profile.json`)**
- Stores default user profile schema (Personal info, Current Role, Target Role, Education, Q&A Bank, and Automation Settings).

---

## 🛠️ Quick Installation
To load the extension in **Brave** or **Chrome**:
1. Open `brave://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `Automate Jobs/LinkedIn/Extension`.
