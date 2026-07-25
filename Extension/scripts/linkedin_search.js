/**
 * LinkedIn SpeedFill – Search Results & Auto-Apply Queue Controller v1.1
 *
 * Responsibilities:
 *  • Inject a floating control widget onto LinkedIn jobs pages
 *  • Iterate through search result job cards
 *  • Detect "Easy Apply" vs. external apply, skip non-Easy Apply
 *  • Detect and skip already-applied jobs
 *  • Handle LinkedIn's SPA navigation (URL change without page reload)
 *  • Relay SPEEDFILL_APPLICATION_SUBMITTED / SPEEDFILL_REVIEW_NEEDED messages
 *    from linkedin_easy_apply.js to update the pill UI
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  let isQueueActive   = false;
  let currentIndex    = -1;
  let appliedCount    = 0;
  let skippedCount    = 0;
  let lastPathname    = location.pathname;

  // ─── SPA Navigation Watcher ─────────────────────────────────────────────────
  // LinkedIn is a SPA — URL changes don't trigger page reloads.
  const navObserver = new MutationObserver(() => {
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      onNavigate();
    }
  });
  navObserver.observe(document.body, { childList: true, subtree: true });

  function onNavigate() {
    if (isJobsPage()) {
      setTimeout(injectPill, 1000);
    } else {
      removePill();
    }
  }

  function isJobsPage() {
    return /linkedin\.com\/jobs/.test(location.href);
  }

  // ─── Pill Injection ─────────────────────────────────────────────────────────
  function injectPill() {
    if (document.getElementById('sf-pill')) return;
    if (!isJobsPage()) return;

    const pill = document.createElement('div');
    pill.id = 'sf-pill';
    pill.className = 'speedfill-floating-pill';
    pill.innerHTML = `
      <div class="speedfill-pill-content">
        <div class="speedfill-pill-header">
          <span class="speedfill-logo">⚡ SpeedFill</span>
          <span id="sf-badge" class="speedfill-badge speedfill-badge-idle">Ready</span>
        </div>
        <div class="speedfill-pill-stats">
          <span>✅ Applied: <strong id="sf-applied">0</strong></span>
          <span>⏭ Skipped: <strong id="sf-skipped">0</strong></span>
        </div>
        <div class="speedfill-pill-actions">
          <button id="sf-start" class="speedfill-btn speedfill-btn-primary">▶ Start Queue</button>
          <button id="sf-pause" class="speedfill-btn speedfill-btn-secondary" style="display:none">⏸ Pause</button>
          <button id="sf-next"  class="speedfill-btn speedfill-btn-ghost">⏭ Next</button>
        </div>
        <div id="sf-job-title" class="speedfill-pill-job" style="display:none"></div>
      </div>
    `;

    document.body.appendChild(pill);

    document.getElementById('sf-start').addEventListener('click', startQueue);
    document.getElementById('sf-pause').addEventListener('click', pauseQueue);
    document.getElementById('sf-next').addEventListener('click', () => {
      currentIndex++;
      processCard();
    });
  }

  function removePill() {
    document.getElementById('sf-pill')?.remove();
  }

  // ─── UI Helpers ─────────────────────────────────────────────────────────────
  function setBadge(text, cls) {
    const badge = document.getElementById('sf-badge');
    if (badge) {
      badge.textContent = text;
      badge.className = `speedfill-badge ${cls}`;
    }
  }

  function updateStats() {
    const a = document.getElementById('sf-applied');
    const s = document.getElementById('sf-skipped');
    if (a) a.textContent = appliedCount;
    if (s) s.textContent = skippedCount;
  }

  function setJobTitle(text) {
    const el = document.getElementById('sf-job-title');
    if (el) {
      el.style.display = text ? 'block' : 'none';
      el.textContent = text;
    }
  }

  // ─── Queue Control ──────────────────────────────────────────────────────────
  function startQueue() {
    isQueueActive = true;
    currentIndex  = -1;
    document.getElementById('sf-start').style.display = 'none';
    document.getElementById('sf-pause').style.display = 'inline-flex';
    setBadge('Running', 'speedfill-badge-active');
    processCard();
  }

  function pauseQueue() {
    isQueueActive = false;
    document.getElementById('sf-start').style.display = 'inline-flex';
    document.getElementById('sf-pause').style.display = 'none';
    setBadge('Paused', 'speedfill-badge-idle');
    setJobTitle('');
  }

  // ─── Job Card Processing ────────────────────────────────────────────────────

  function getJobCards() {
    // LinkedIn has multiple DOM variants — try each and merge unique results
    const selectors = [
      '.jobs-search-results-list__list-item',
      '.scaffold-layout__list-item',
      'li.jobs-search-results__list-item',
      'div[data-job-id]',
      'li[data-occludable-job-id]',
      '.job-card-container'
    ];
    const seen = new Set();
    const cards = [];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        if (!seen.has(el)) { seen.add(el); cards.push(el); }
      });
    }
    return cards;
  }

  function isAlreadyApplied(card) {
    // LinkedIn marks applied jobs with a green checkmark li or 'Applied X ago' text
    const appliedIcon = card.querySelector(
      '.job-card-container__footer-job-state, ' +
      '[class*="applied"], ' +
      'li.job-card-container__footer-item--highlighted'
    );
    if (appliedIcon) return true;

    const text = card.textContent || '';
    // Check for 'Applied' but avoid false positive on 'Easy Apply'
    return /\bApplied\b/i.test(text) && !/easy apply/i.test(card.textContent.replace(/applied/gi, ''));
  }

  function hasEasyApplyBadge(card) {
    if (card.querySelector('[aria-label*="Easy Apply"], [class*="easy-apply"], .job-card-container__easy-apply-label')) return true;
    return /easy apply/i.test(card.textContent);
  }

  function processCard() {
    if (!isQueueActive) return;

    const cards = getJobCards();
    currentIndex++;

    if (currentIndex >= cards.length) {
      setBadge('End of List', 'speedfill-badge-warning');
      pauseQueue();
      return;
    }

    const card = cards[currentIndex];

    // Smooth scroll to card
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Reset border from previous pass
    card.style.outline = '';

    // Already applied → skip fast
    if (isAlreadyApplied(card)) {
      card.style.opacity = '0.45';
      skippedCount++;
      updateStats();
      setBadge(`Skipped (${skippedCount})`, 'speedfill-badge-idle');
      setTimeout(processCard, 500);
      return;
    }

    // Only Easy Apply jobs — skip anything else after checking the detail pane
    card.style.outline = '2px solid #0a66c2';
    card.style.borderRadius = '8px';

    // Click to open job details pane
    const anchor = card.querySelector(
      'a.job-card-container__link, a.job-card-list__title, ' +
      '.job-card-list__title--link, a[data-job-id]'
    ) || card;
    anchor.click();

    const jobName = card.querySelector(
      '.job-card-list__title, .job-card-container__link'
    )?.textContent?.trim() || `Job #${currentIndex + 1}`;
    setJobTitle(`🔍 ${jobName}`);
    setBadge(`Checking…`, 'speedfill-badge-active');

    // Wait for right-pane detail to render, then look for Easy Apply button
    setTimeout(tryClickEasyApply, 1400);
  }

  function tryClickEasyApply() {
    if (!isQueueActive) return;

    // Multiple selector strategies for the Easy Apply button
    const btnSelectors = [
      'button[aria-label*="Easy Apply"]',
      '.jobs-apply-button button',
      '.jobs-s-apply button',
      'button.jobs-apply-button',
      '.jobs-apply-button--top-card button'
    ];

    let btn = null;
    for (const sel of btnSelectors) {
      const found = document.querySelector(sel);
      if (found && !found.disabled) {
        // Make sure it's the Easy Apply variant (not an external apply button)
        const label = (found.getAttribute('aria-label') || found.textContent || '').toLowerCase();
        if (label.includes('easy apply') || found.closest('.jobs-apply-button--top-card')) {
          btn = found;
          break;
        }
      }
    }

    // Last resort: find any button whose text is exactly 'Easy Apply'
    if (!btn) {
      btn = Array.from(document.querySelectorAll('button')).find(b =>
        !b.disabled && b.textContent.trim().toLowerCase() === 'easy apply'
      );
    }

    if (btn) {
      const jobTitle = document.querySelector(
        '.jobs-unified-top-card__job-title, .t-24.t-bold, h1.t-24'
      )?.textContent?.trim() || '';
      setJobTitle(`🚀 Applying: ${jobTitle}`);
      setBadge('Applying…', 'speedfill-badge-active');
      btn.click();
      // linkedin_easy_apply.js takes over the modal
    } else {
      // Not Easy Apply — skip
      skippedCount++;
      updateStats();
      setBadge(`Skipped (${skippedCount})`, 'speedfill-badge-idle');
      setJobTitle('');
      setTimeout(processCard, 900);
    }
  }

  // ─── Message Bus ────────────────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    if (!ev.data?.type) return;

    if (ev.data.type === 'SPEEDFILL_APPLICATION_SUBMITTED') {
      appliedCount++;
      updateStats();
      setBadge(`Applied ✓ (${appliedCount})`, 'speedfill-badge-success');
      setJobTitle('');
      if (isQueueActive) {
        setTimeout(processCard, 1800);
      }
    }

    if (ev.data.type === 'SPEEDFILL_REVIEW_NEEDED') {
      setBadge('⚠️ Review Needed', 'speedfill-badge-warning');
      isQueueActive = false;
      document.getElementById('sf-start').style.display = 'inline-flex';
      document.getElementById('sf-pause').style.display = 'none';
    }
  });

  // ─── Boot ──────────────────────────────────────────────────────────────────
  function init() {
    if (isJobsPage()) {
      setTimeout(injectPill, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
