/**
 * LinkedIn SpeedFill - Dashboard Controller
 * Profile management & extension configuration sync
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const saveBtn = document.getElementById('save-btn');
  const addQaBtn = document.getElementById('add-qa-btn');
  const qaContainer = document.getElementById('qa-container');
  const resetDefaultsBtn = document.getElementById('reset-defaults-btn');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const stepDelayInput = document.getElementById('stepDelayMs');
  const stepDelayDisplay = document.getElementById('stepDelayDisplay');
  const toast = document.getElementById('toast');

  let currentProfile = {};

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetTab = btn.getAttribute('data-tab');
      document.getElementById(targetTab).classList.add('active');
    });
  });

  // Theme toggle
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-theme');
    const isLight = document.body.classList.contains('light-theme');
    themeToggleBtn.textContent = isLight ? '☀️' : '🌙';
  });

  // Slider update
  stepDelayInput.addEventListener('input', (e) => {
    stepDelayDisplay.textContent = `${e.target.value} ms`;
  });

  // Load profile from storage
  function loadProfile() {
    chrome.storage.local.get(['userProfile'], (result) => {
      if (result.userProfile) {
        currentProfile = result.userProfile;
        populateForm(currentProfile);
      } else {
        // Fetch default JSON if storage empty
        fetch(chrome.runtime.getURL('data/default_profile.json'))
          .then(res => res.json())
          .then(data => {
            currentProfile = data;
            chrome.storage.local.set({ userProfile: data });
            populateForm(data);
          });
      }
    });
  }

  function populateForm(p) {
    if (!p) return;

    // Personal
    document.getElementById('fullName').value = p.personal?.fullName || '';
    document.getElementById('firstName').value = p.personal?.firstName || '';
    document.getElementById('lastName').value = p.personal?.lastName || '';
    document.getElementById('email').value = p.personal?.email || '';
    document.getElementById('phone').value = p.personal?.phone || '';
    document.getElementById('city').value = p.personal?.city || '';
    document.getElementById('state').value = p.personal?.state || '';
    document.getElementById('linkedin').value = p.personal?.linkedin || '';

    // Roles
    document.getElementById('currentJobTitle').value = p.work?.currentRole?.jobTitle || '';
    document.getElementById('currentCompany').value = p.work?.currentRole?.company || '';
    document.getElementById('yearsExperience').value = p.work?.currentRole?.yearsExperience || '';
    document.getElementById('currentSalary').value = p.work?.currentRole?.currentSalary || '';

    document.getElementById('targetJobTitle').value = p.work?.targetRole?.jobTitle || '';
    document.getElementById('targetLocation').value = p.work?.targetRole?.targetLocation || '';
    document.getElementById('noticePeriod').value = p.work?.targetRole?.noticePeriod || '';
    document.getElementById('expectedSalary').value = p.work?.targetRole?.expectedSalary || '';

    // Education
    document.getElementById('degree').value = p.education?.degree || '';
    document.getElementById('major').value = p.education?.major || '';
    document.getElementById('university').value = p.education?.university || '';
    document.getElementById('graduationYear').value = p.education?.graduationYear || '';

    // Settings
    document.getElementById('autoFillOnLoad').checked = !!p.settings?.autoFillOnLoad;
    document.getElementById('pauseOnUnmatchedFields').checked = !!p.settings?.pauseOnUnmatchedFields;
    document.getElementById('stepDelayMs').value = p.settings?.stepDelayMs ?? 500;
    stepDelayDisplay.textContent = `${p.settings?.stepDelayMs ?? 500} ms`;
    document.getElementById('autoSelectResume').checked = !!p.settings?.autoSelectResume;
    document.getElementById('autoAdvanceStep').checked = !!p.settings?.autoAdvanceStep;
    document.getElementById('autoSubmitApplication').checked = !!p.settings?.autoSubmitApplication;
    document.getElementById('highlightFilledFields').checked = !!p.settings?.highlightFilledFields;

    // Q&A Bank
    renderQaBank(p.screening || []);
  }

  function renderQaBank(qaItems) {
    qaContainer.innerHTML = '';
    qaItems.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'qa-card';
      card.innerHTML = `
        <div class="qa-card-header">
          <span class="qa-title">Question #${index + 1}</span>
          <button class="btn-delete" data-index="${index}">🗑️</button>
        </div>
        <div class="form-group">
          <label>Keyword Triggers (comma separated)</label>
          <input type="text" class="qa-keywords" value="${item.keywords || ''}" placeholder="e.g. react, python, relocation">
        </div>
        <div class="form-group">
          <label>Pre-Saved Answer</label>
          <input type="text" class="qa-answer" value="${item.answer || ''}" placeholder="e.g. Yes, 3+ years experience">
        </div>
      `;
      qaContainer.appendChild(card);
    });

    // Delete handlers
    qaContainer.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        currentProfile.screening.splice(index, 1);
        renderQaBank(currentProfile.screening);
      });
    });
  }

  // Add Q&A Item
  addQaBtn.addEventListener('click', () => {
    if (!currentProfile.screening) currentProfile.screening = [];
    currentProfile.screening.push({ keywords: '', answer: '' });
    renderQaBank(currentProfile.screening);
  });

  // Save profile to storage
  saveBtn.addEventListener('click', () => {
    const updatedProfile = {
      personal: {
        fullName: document.getElementById('fullName').value,
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        linkedin: document.getElementById('linkedin').value
      },
      work: {
        currentRole: {
          jobTitle: document.getElementById('currentJobTitle').value,
          company: document.getElementById('currentCompany').value,
          yearsExperience: document.getElementById('yearsExperience').value,
          currentSalary: document.getElementById('currentSalary').value
        },
        targetRole: {
          jobTitle: document.getElementById('targetJobTitle').value,
          targetLocation: document.getElementById('targetLocation').value,
          noticePeriod: document.getElementById('noticePeriod').value,
          expectedSalary: document.getElementById('expectedSalary').value
        }
      },
      education: {
        degree: document.getElementById('degree').value,
        major: document.getElementById('major').value,
        university: document.getElementById('university').value,
        graduationYear: document.getElementById('graduationYear').value
      },
      screening: Array.from(qaContainer.querySelectorAll('.qa-card')).map(card => ({
        keywords: card.querySelector('.qa-keywords').value,
        answer: card.querySelector('.qa-answer').value
      })),
      settings: {
        autoFillOnLoad: document.getElementById('autoFillOnLoad').checked,
        pauseOnUnmatchedFields: document.getElementById('pauseOnUnmatchedFields').checked,
        stepDelayMs: parseInt(document.getElementById('stepDelayMs').value, 10),
        autoSelectResume: document.getElementById('autoSelectResume').checked,
        autoAdvanceStep: document.getElementById('autoAdvanceStep').checked,
        autoSubmitApplication: document.getElementById('autoSubmitApplication').checked,
        highlightFilledFields: document.getElementById('highlightFilledFields').checked
      }
    };

    chrome.storage.local.set({ userProfile: updatedProfile }, () => {
      showToast('Profile Saved Successfully!');
    });
  });

  // Reset defaults
  resetDefaultsBtn.addEventListener('click', () => {
    if (confirm('Reset profile to default demo settings?')) {
      fetch(chrome.runtime.getURL('data/default_profile.json'))
        .then(res => res.json())
        .then(data => {
          chrome.storage.local.set({ userProfile: data }, () => {
            currentProfile = data;
            populateForm(data);
            showToast('Profile Reset to Default!');
          });
        });
    }
  });

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  loadProfile();
});
