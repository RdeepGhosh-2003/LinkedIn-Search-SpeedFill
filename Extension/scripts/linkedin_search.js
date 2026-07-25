/**
 * LinkedIn SpeedFill - Search Results & Auto-Apply Controller
 * Handles job list scanning, Easy Apply filtering, queue progression on linkedin.com/jobs
 */

(function() {
  'use strict';

  let profileData = null;
  let isAutoQueueActive = false;
  let appliedCount = 0;
  let skippedCount = 0;
  let currentJobIndex = -1;

  // Load profile from storage
  function loadProfile() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['userProfile'], (result) => {
        if (result.userProfile) {
          profileData = result.userProfile;
          if (profileData.settings && profileData.settings.autoQueueSearchJobs) {
            // Auto queue feature flag
          }
        }
      });
    }
  }

  // Inject top floating control pill widget on LinkedIn search page
  function injectFloatingPill() {
    if (document.getElementById('speedfill-linkedin-bar')) return;

    const bar = document.createElement('div');
    bar.id = 'speedfill-linkedin-bar';
    bar.className = 'speedfill-floating-pill';
    bar.innerHTML = `
      <div class="speedfill-pill-content">
        <div class="speedfill-pill-header">
          <span class="speedfill-logo">⚡ LinkedIn SpeedFill</span>
          <span id="speedfill-status-badge" class="speedfill-badge speedfill-badge-idle">Ready</span>
        </div>
        <div class="speedfill-pill-stats">
          <span>Applied: <strong id="speedfill-applied-count">0</strong></span>
          <span>Skipped: <strong id="speedfill-skipped-count">0</strong></span>
        </div>
        <div class="speedfill-pill-actions">
          <button id="speedfill-btn-start" class="speedfill-btn speedfill-btn-primary">▶ Start Queue</button>
          <button id="speedfill-btn-pause" class="speedfill-btn speedfill-btn-secondary" style="display:none;">⏸ Pause</button>
          <button id="speedfill-btn-next" class="speedfill-btn speedfill-btn-ghost">⏭ Next Job</button>
        </div>
      </div>
    `;

    document.body.appendChild(bar);

    // Event listeners
    document.getElementById('speedfill-btn-start').addEventListener('click', startQueue);
    document.getElementById('speedfill-btn-pause').addEventListener('click', pauseQueue);
    document.getElementById('speedfill-btn-next').addEventListener('click', processNextJobCard);
  }

  function updateStatus(statusText, badgeClass) {
    const badge = document.getElementById('speedfill-status-badge');
    if (badge) {
      badge.textContent = statusText;
      badge.className = `speedfill-badge ${badgeClass}`;
    }
  }

  function updateStats() {
    const appliedEl = document.getElementById('speedfill-applied-count');
    const skippedEl = document.getElementById('speedfill-skipped-count');
    if (appliedEl) appliedEl.textContent = appliedCount;
    if (skippedEl) skippedEl.textContent = skippedCount;
  }

  function startQueue() {
    isAutoQueueActive = true;
    document.getElementById('speedfill-btn-start').style.display = 'none';
    document.getElementById('speedfill-btn-pause').style.display = 'inline-flex';
    updateStatus('Queue Active', 'speedfill-badge-active');
    processNextJobCard();
  }

  function pauseQueue() {
    isAutoQueueActive = false;
    document.getElementById('speedfill-btn-start').style.display = 'inline-flex';
    document.getElementById('speedfill-btn-pause').style.display = 'none';
    updateStatus('Paused', 'speedfill-badge-idle');
  }

  // Get all job cards visible on LinkedIn search page
  function getJobCards() {
    const cards = document.querySelectorAll('.jobs-search-results-list li, .scaffold-layout__list-item, div[data-job-id]');
    return Array.from(cards);
  }

  // Process next job card in search list
  function processNextJobCard() {
    if (!isAutoQueueActive) return;

    const cards = getJobCards();
    currentJobIndex++;

    if (currentJobIndex >= cards.length) {
      updateStatus('End of List', 'speedfill-badge-warning');
      pauseQueue();
      return;
    }

    const card = cards[currentJobIndex];
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Check if card is already applied
    const text = card.textContent || '';
    if (text.includes('Applied') || text.includes('Applied ')) {
      skippedCount++;
      updateStats();
      card.style.opacity = '0.5';
      setTimeout(processNextJobCard, 600);
      return;
    }

    // Check if job is "Easy Apply"
    const isEasyApply = text.includes('Easy Apply') || card.querySelector('.job-card-container__apply-method, svg[data-test-icon="linkedin-bug-color-icon"]');
    
    // Highlight card
    card.style.border = '2px solid #0a66c2';
    card.style.borderRadius = '8px';

    // Click the job card to select it
    const clickTarget = card.querySelector('a.job-card-container__link, .job-card-list__title, a.job-card-list__title') || card;
    clickTarget.click();

    updateStatus(`Checking Job ${currentJobIndex + 1}...`, 'speedfill-badge-active');

    // Wait for job details pane to render
    setTimeout(() => {
      triggerEasyApplyButton();
    }, 1200);
  }

  // Find and click the "Easy Apply" button in the right detail pane
  function triggerEasyApplyButton() {
    if (!isAutoQueueActive) return;

    // Look for Easy Apply button in right pane
    const easyApplyBtn = document.querySelector('.jobs-apply-button--top-card button, button.jobs-apply-button, button[data-job-apply-button]');
    
    if (easyApplyBtn && (easyApplyBtn.textContent.includes('Easy Apply') || easyApplyBtn.getAttribute('aria-label')?.includes('Easy Apply'))) {
      updateStatus('Opening Easy Apply...', 'speedfill-badge-active');
      easyApplyBtn.click();
      
      // The Easy Apply Modal engine (linkedin_easy_apply.js) will take over multi-step form filling.
    } else {
      // Not an Easy Apply job or already applied
      skippedCount++;
      updateStats();
      setTimeout(processNextJobCard, 1000);
    }
  }

  // Listen for messages from linkedin_easy_apply.js when an application completes
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SPEEDFILL_APPLICATION_SUBMITTED') {
      appliedCount++;
      updateStats();
      updateStatus('Applied Successfully!', 'speedfill-badge-success');
      
      if (isAutoQueueActive) {
        setTimeout(processNextJobCard, 1500);
      }
    } else if (event.data && event.data.type === 'SPEEDFILL_REVIEW_NEEDED') {
      updateStatus('⚠️ Review Needed', 'speedfill-badge-warning');
    }
  });

  // Init listener
  function init() {
    loadProfile();

    // Check if on LinkedIn jobs page
    if (window.location.href.includes('linkedin.com/jobs')) {
      setTimeout(injectFloatingPill, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
