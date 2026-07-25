/**
 * LinkedIn SpeedFill – Popup Controller v1.1
 * Handles: profile CRUD, Q&A bank management, application logs, CSV export
 */

document.addEventListener('DOMContentLoaded', () => {

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const tabBtns        = document.querySelectorAll('.tab-btn');
  const tabPanes       = document.querySelectorAll('.tab-pane');
  const saveBtn        = document.getElementById('save-btn');
  const themeBtn       = document.getElementById('theme-toggle-btn');
  const addQaBtn       = document.getElementById('add-qa-btn');
  const qaContainer    = document.getElementById('qa-container');
  const resetBtn       = document.getElementById('reset-defaults-btn');
  const stepDelayInput = document.getElementById('stepDelayMs');
  const stepDelayDisp  = document.getElementById('stepDelayDisplay');
  const toast          = document.getElementById('toast');
  const exportBtn      = document.getElementById('export-csv-btn');
  const clearLogsBtn   = document.getElementById('clear-logs-btn');

  let currentProfile = {};

  // ─── Tab switching ───────────────────────────────────────────────────────
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');

      // Refresh logs on tab open
      if (btn.dataset.tab === 'tab-logs') loadLogs();
    });
  });

  // ─── Theme toggle ────────────────────────────────────────────────────────
  themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light');
    themeBtn.textContent = document.body.classList.contains('light') ? '☀️' : '🌙';
  });

  // ─── Delay slider ────────────────────────────────────────────────────────
  stepDelayInput.addEventListener('input', e => {
    stepDelayDisp.textContent = `${e.target.value} ms`;
  });

  // ─── Profile Load ────────────────────────────────────────────────────────
  function loadProfile() {
    chrome.storage.local.get(['userProfile'], result => {
      if (result.userProfile) {
        currentProfile = result.userProfile;
        populateForm(currentProfile);
      } else {
        fetch(chrome.runtime.getURL('data/default_profile.json'))
          .then(r => r.json())
          .then(data => {
            currentProfile = data;
            chrome.storage.local.set({ userProfile: data });
            populateForm(data);
          })
          .catch(() => showToast('Could not load default profile', true));
      }
    });
  }

  function populateForm(p) {
    if (!p) return;

    // Personal
    setVal('fullName',     p.personal?.fullName);
    setVal('firstName',    p.personal?.firstName);
    setVal('lastName',     p.personal?.lastName);
    setVal('email',        p.personal?.email);
    setVal('phone',        p.personal?.phone);
    setVal('city',         p.personal?.city);
    setVal('state',        p.personal?.state);
    setVal('linkedin',     p.personal?.linkedin);

    // Roles
    setVal('currentJobTitle',  p.work?.currentRole?.jobTitle);
    setVal('currentCompany',   p.work?.currentRole?.company);
    setVal('yearsExperience',  p.work?.currentRole?.yearsExperience);
    setVal('currentSalary',    p.work?.currentRole?.currentSalary);
    setVal('targetJobTitle',   p.work?.targetRole?.jobTitle);
    setVal('targetLocation',   p.work?.targetRole?.targetLocation);
    setVal('noticePeriod',     p.work?.targetRole?.noticePeriod);
    setVal('expectedSalary',   p.work?.targetRole?.expectedSalary);

    // Education
    setVal('degree',         p.education?.degree);
    setVal('major',          p.education?.major);
    setVal('university',     p.education?.university);
    setVal('graduationYear', p.education?.graduationYear);

    // Settings
    setCheck('autoFillOnLoad',         p.settings?.autoFillOnLoad);
    setCheck('pauseOnUnmatchedFields', p.settings?.pauseOnUnmatchedFields);
    setCheck('autoSelectResume',       p.settings?.autoSelectResume);
    setCheck('autoAdvanceStep',        p.settings?.autoAdvanceStep);
    setCheck('autoSubmitApplication',  p.settings?.autoSubmitApplication);
    setCheck('highlightFilledFields',  p.settings?.highlightFilledFields);
    setCheck('learnOnTheGo',           p.settings?.learnOnTheGo ?? true);

    const delay = p.settings?.stepDelayMs ?? 600;
    stepDelayInput.value = delay;
    stepDelayDisp.textContent = `${delay} ms`;

    // Q&A bank
    renderQaBank(p.screening || []);
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  }

  function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  }

  // ─── Q&A Bank ────────────────────────────────────────────────────────────
  function renderQaBank(items) {
    qaContainer.innerHTML = '';
    items.forEach((item, i) => {
      const card = document.createElement('div');
      card.className = 'qa-card';
      card.innerHTML = `
        <div class="qa-card-header">
          <span class="qa-index">Answer #${i + 1}</span>
          <button class="qa-delete" data-i="${i}" title="Delete">🗑️</button>
        </div>
        <div class="form-group">
          <label>Keywords (comma-separated)</label>
          <input type="text" class="qa-kw" value="${escHtml(item.keywords || '')}"
                 placeholder="e.g. notice period, start date">
        </div>
        <div class="form-group">
          <label>Pre-Saved Answer</label>
          <input type="text" class="qa-ans" value="${escHtml(item.answer || '')}"
                 placeholder="e.g. 30 Days">
        </div>
      `;
      qaContainer.appendChild(card);
    });

    qaContainer.querySelectorAll('.qa-delete').forEach(btn => {
      btn.addEventListener('click', e => {
        const idx = parseInt(e.currentTarget.dataset.i, 10);
        if (!currentProfile.screening) currentProfile.screening = [];
        currentProfile.screening.splice(idx, 1);
        renderQaBank(currentProfile.screening);
      });
    });
  }

  addQaBtn.addEventListener('click', () => {
    if (!currentProfile.screening) currentProfile.screening = [];
    currentProfile.screening.push({ keywords: '', answer: '' });
    renderQaBank(currentProfile.screening);
  });

  // ─── Save ────────────────────────────────────────────────────────────────
  saveBtn.addEventListener('click', () => {
    const updated = {
      personal: {
        fullName:  getVal('fullName'),
        firstName: getVal('firstName'),
        lastName:  getVal('lastName'),
        email:     getVal('email'),
        phone:     getVal('phone'),
        city:      getVal('city'),
        state:     getVal('state'),
        linkedin:  getVal('linkedin')
      },
      work: {
        currentRole: {
          jobTitle:        getVal('currentJobTitle'),
          company:         getVal('currentCompany'),
          yearsExperience: getVal('yearsExperience'),
          currentSalary:   getVal('currentSalary')
        },
        targetRole: {
          jobTitle:       getVal('targetJobTitle'),
          targetLocation: getVal('targetLocation'),
          noticePeriod:   getVal('noticePeriod'),
          expectedSalary: getVal('expectedSalary')
        }
      },
      education: {
        degree:         getVal('degree'),
        major:          getVal('major'),
        university:     getVal('university'),
        graduationYear: getVal('graduationYear')
      },
      screening: Array.from(qaContainer.querySelectorAll('.qa-card')).map(card => ({
        keywords: card.querySelector('.qa-kw')?.value  || '',
        answer:   card.querySelector('.qa-ans')?.value || ''
      })),
      settings: {
        autoFillOnLoad:         getCheck('autoFillOnLoad'),
        pauseOnUnmatchedFields: getCheck('pauseOnUnmatchedFields'),
        stepDelayMs:            parseInt(stepDelayInput.value, 10),
        autoSelectResume:       getCheck('autoSelectResume'),
        autoAdvanceStep:        getCheck('autoAdvanceStep'),
        autoSubmitApplication:  getCheck('autoSubmitApplication'),
        highlightFilledFields:  getCheck('highlightFilledFields'),
        learnOnTheGo:           getCheck('learnOnTheGo')
      }
    };

    chrome.storage.local.set({ userProfile: updated }, () => {
      currentProfile = updated;
      showToast('Profile Saved ✓');
    });
  });

  function getVal(id)   { return document.getElementById(id)?.value.trim() || ''; }
  function getCheck(id) { return !!document.getElementById(id)?.checked; }

  // ─── Reset Defaults ──────────────────────────────────────────────────────
  resetBtn.addEventListener('click', () => {
    if (!confirm('Reset all profile fields to default example values?')) return;
    fetch(chrome.runtime.getURL('data/default_profile.json'))
      .then(r => r.json())
      .then(data => {
        chrome.storage.local.set({ userProfile: data }, () => {
          currentProfile = data;
          populateForm(data);
          showToast('Profile Reset ✓');
        });
      });
  });

  // ─── Application Logs ────────────────────────────────────────────────────
  function loadLogs() {
    chrome.storage.local.get(['applicationLog'], result => {
      const log = result.applicationLog || [];
      renderLogs(log);
    });
  }

  function renderLogs(log) {
    const total    = log.length;
    const now      = new Date();
    const todayStr = now.toDateString();
    const weekAgo  = new Date(now - 7  * 864e5);
    const monthAgo = new Date(now - 30 * 864e5);

    const todayCount = log.filter(e => new Date(e.timestamp).toDateString() === todayStr).length;
    const weekCount  = log.filter(e => new Date(e.timestamp) >= weekAgo).length;
    const monthCount = log.filter(e => new Date(e.timestamp) >= monthAgo).length;

    document.getElementById('total-count').textContent = total;
    document.getElementById('stat-today').textContent  = todayCount;
    document.getElementById('stat-week').textContent   = weekCount;
    document.getElementById('stat-month').textContent  = monthCount;

    const listEl = document.getElementById('logs-list');
    if (total === 0) {
      listEl.innerHTML = `<div class="logs-empty">No applications logged yet.<br>Start applying with SpeedFill!</div>`;
      return;
    }

    listEl.innerHTML = log.map(entry => {
      const d = new Date(entry.timestamp);
      const dateStr = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
      const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      return `
        <div class="log-item">
          <div class="log-item-title">💼 ${escHtml(entry.jobTitle)}</div>
          <div class="log-item-meta">
            <span>🏢 ${escHtml(entry.companyName)}</span>
            <span>${dateStr}, ${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Export CSV ──────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['applicationLog'], result => {
      const log = result.applicationLog || [];
      if (log.length === 0) { showToast('No logs to export', true); return; }

      const header = 'Job Title,Company,URL,Date,Time';
      const rows   = log.map(e => {
        const d = new Date(e.timestamp);
        return [
          csvCell(e.jobTitle),
          csvCell(e.companyName),
          csvCell(e.url),
          d.toLocaleDateString('en-IN'),
          d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        ].join(',');
      });

      const csv  = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `linkedin_speedfill_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV Exported ✓');
    });
  });

  function csvCell(val) {
    return '"' + String(val || '').replace(/"/g, '""') + '"';
  }

  // ─── Clear Logs ──────────────────────────────────────────────────────────
  clearLogsBtn.addEventListener('click', () => {
    if (!confirm('Clear all application logs? This cannot be undone.')) return;
    chrome.storage.local.set({ applicationLog: [] }, () => {
      renderLogs([]);
      showToast('Logs Cleared');
    });
  });

  // ─── Toast ───────────────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, isError = false) {
    toast.textContent = msg;
    toast.className   = 'toast show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = 'toast'; }, 2600);
  }

  // ─── Utility ─────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Boot ────────────────────────────────────────────────────────────────
  loadProfile();
  loadLogs();
});
