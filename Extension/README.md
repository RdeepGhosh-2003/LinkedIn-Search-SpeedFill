# ⚡ LinkedIn SpeedFill - Chrome & Brave Auto-Apply Engine

![LinkedIn SpeedFill Banner](https://img.shields.io/badge/LinkedIn-SpeedFill-0a66c2?style=for-the-badge&logo=linkedin)

**LinkedIn SpeedFill** is a high-performance Manifest V3 browser extension built for **Chrome** and **Brave**. It automates multi-step **LinkedIn Easy Apply** job applications and streamlines **LinkedIn search results** with sub-10ms local fuzzy field matching, smart radio/combobox handling, automatic resume selection, step delay controls, and safety review pauses.

---

## 🌟 Key Features & Capabilities

### ⚡ 1. LinkedIn Easy Apply Automation
- **Sub-10ms Local Matching**: Fills out personal information, work history (Current vs Target role), education, and custom screening questions in real-time.
- **Native React Binding**: Triggers synthetic React `input`, `change`, and `blur` events so LinkedIn form state updates immediately, enabling the **Next** / **Review** / **Submit** buttons.
- **Radio & Dropdown Choice**: Automatically answers work authorization, sponsorship, relocation, and experience radio/combobox fields.

### 🔍 2. Search Results Assistant & Queue Controller
- Injects a floating control pill widget directly onto `linkedin.com/jobs`.
- **1-Click Queue Engine**: Automatically clicks Easy Apply, runs through the application step-by-step, closes confirmation dialogs, and advances to the next job in your search list.
- **Applied Job Detection**: Skips already applied job listings automatically.

### 📄 3. Auto Resume Selection
- Auto-selects attached PDF resumes on the *"Resume"* step and advances to the next step without requiring manual clicks.

### 🛑 4. Pause on Missing / Unfilled Data
- Guarantees incomplete applications are never submitted blindly.
- If a required field has no matching answer in your dashboard profile or Q&A bank, auto-advance pauses safely, highlighting the field with an **amber glowing border** (`speedfill-warning`).

### ⏱️ 5. Configurable Human-Like Step Delay Slider
- Adjust delay from `0 ms` (instant) to `10,000 ms` (10 seconds) in steps of `100 ms` to customize your automation speed.

---

## 🛠️ Step-by-Step Installation Guide

Because **Brave is built on Chromium**, the exact same extension loads natively in both **Brave** and **Chrome**.

```
📁 Project Path: ./Automate Jobs/LinkedIn/Extension
```

### 1️⃣ Installing in Brave Browser
1. Open **Brave** and type `brave://extensions` in your address bar.
2. Enable **Developer mode** (toggle switch in top right corner).
3. Click the **Load unpacked** button in top left.
4. Browse to your project folder (`path/to/Automate Jobs/LinkedIn/Extension`) and click **Select Folder**.
5. Pin **LinkedIn SpeedFill** (📌) to your toolbar for quick access.

### 2️⃣ Installing in Chrome Browser
1. Open **Chrome** and type `chrome://extensions` in your address bar.
2. Enable **Developer mode** in top right corner.
3. Click **Load unpacked**.
4. Select your project folder (`path/to/Automate Jobs/LinkedIn/Extension`).
5. Pin **LinkedIn SpeedFill** (📌) to your toolbar.

---

## 🖥️ Extension Dashboard & Configuration

Click the **⚡ SpeedFill icon** on your browser toolbar to open your dashboard window:

| Tab | Purpose & Settings |
| :--- | :--- |
| **💼 Roles** | Edit **Current Role** (Title, Company, Experience, Salary) and **Target Role** (Target Title, Location, Expected CTC, Notice Period). |
| **👤 Personal** | Edit Full Name, Contact Details, Email, Phone, City, and LinkedIn URL. |
| **🎓 Education** | Edit Degree, Major, University, and Graduation Year. |
| **❓ Q&A Bank** | Pre-save custom keyword triggers and answers for employer screening questions. |
| **⚙️ Settings** | Toggle **Auto-fill On Load**, **Pause on Missing Data**, **Auto-Select Resume**, **Auto-Advance Steps**, **Auto-Submit**, and adjust the **Step Delay Slider (0–10,000 ms)**. |

---

## 📁 Project Architecture

```
Automate Jobs/
└── LinkedIn/
    └── Extension/
        ├── manifest.json            # Extension Manifest V3 configuration
        ├── README.md                # Usage guide & feature documentation
        ├── data/
        │   └── default_profile.json # Master user profile JSON data
        ├── popup/
        │   ├── popup.html           # Profile & Dashboard UI HTML layout
        │   ├── popup.css            # Dark mode sleek design system
        │   └── popup.js             # Dashboard controller & local storage sync
        └── scripts/
            ├── matcher.js           # Sub-10ms label & question identifier engine
            ├── linkedin_search.js   # Search results & floating control pill widget
            ├── linkedin_easy_apply.js# Core Easy Apply modal auto-fill & step navigator
            ├── background.js        # Service worker (hotkeys & desktop alerts)
            └── content.css          # Injected emerald highlight & warning styles
```

---

## ⌨️ Keyboard Shortcuts
- Press **Alt + F** anytime to instantly trigger auto-fill on the current LinkedIn Easy Apply modal.
