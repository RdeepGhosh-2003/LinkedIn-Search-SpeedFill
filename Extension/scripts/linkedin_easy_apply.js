/**
 * LinkedIn SpeedFill – Easy Apply Modal Engine v1.1
 *
 * Responsibilities:
 *  • Detect the Easy Apply modal opening via MutationObserver (debounced)
 *  • Fill text inputs, numeric fields, textareas
 *  • Answer radio groups (fieldsets) using Q&A bank + smart fallbacks
 *  • Handle <select> dropdowns
 *  • Auto-select resume card
 *  • Auto-advance (Next → Review → Submit) with configurable delay
 *  • Safe pause + amber highlight on unfilled required fields
 *  • Persist application log entry on submit
 */

(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  let profile = null;
  let observer = null;
  let stepTimer = null;
  let lastModalHash = '';     // debounce: only reprocess if modal content changed
  let processingLock = false; // prevent re-entrant processModalStep calls

  // ─── Selectors ─────────────────────────────────────────────────────────────
  const MODAL_SELECTOR =
    '.jobs-easy-apply-modal, ' +
    '[data-test-modal][aria-labelledby*="jobs-easy-apply"], ' +
    'div.artdeco-modal[role="dialog"]';

  /**
   * Returns true only if the dialog is a LinkedIn Easy Apply dialog
   * (not a "report job", "share", or "sign-in" dialog).
   */
  function isEasyApplyModal(el) {
    if (!el) return false;
    const text = (el.getAttribute('aria-labelledby') || '') +
                 (el.querySelector('.jobs-easy-apply-modal__title, h2')?.textContent || '');
    // Must contain the Easy Apply header text or the known class
    return (
      el.classList.contains('jobs-easy-apply-modal') ||
      el.querySelector('.jobs-easy-apply-modal__title, h2.t-24') !== null ||
      text.toLowerCase().includes('easy apply')
    );
  }

  // ─── Profile loading ────────────────────────────────────────────────────────
  function loadProfile(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(['userProfile'], result => {
      profile = result.userProfile || getDefaultProfile();
      if (callback) callback();
    });
  }

  function getDefaultProfile() {
    return {
      personal: { fullName: '', firstName: '', lastName: '', email: '', phone: '', city: '', state: '' },
      work: {
        currentRole: { jobTitle: '', company: '', yearsExperience: '', currentSalary: '' },
        targetRole: { jobTitle: '', targetLocation: '', expectedSalary: '', noticePeriod: '' }
      },
      education: { degree: '', major: '', university: '', graduationYear: '' },
      screening: [],
      settings: {
        autoFillOnLoad: true, pauseOnUnmatchedFields: true, stepDelayMs: 600,
        autoSelectResume: true, autoAdvanceStep: true, autoSubmitApplication: false,
        highlightFilledFields: true
      }
    };
  }

  // ─── React-aware value setter ───────────────────────────────────────────────
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                   Object.getOwnPropertyDescriptor(el, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  // ─── Processors ────────────────────────────────────────────────────────────

  /** Fill text / number / email / tel / textarea inputs */
  function processInputs(modal) {
    let hasUnfilled = false;
    const inputs = modal.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="email"], ' +
      'input[type="tel"], input:not([type]), textarea'
    );

    inputs.forEach(input => {
      // Skip if user manually edited this field
      if (input.dataset.speedfillUserEdited === 'true') return;
      // Skip already-filled fields
      if (input.value && input.value.trim() !== '') return;
      // Skip hidden / readonly / disabled
      if (input.hidden || input.disabled || input.readOnly) return;

      const match = window.SpeedFillMatcher?.matchField(input, profile);

      if (match?.value) {
        setNativeValue(input, match.value);
        if (profile.settings?.highlightFilledFields) {
          input.classList.add('speedfill-highlight');
          input.classList.remove('speedfill-warning');
        }
        // Mark so we don't refill it on re-run
        input.dataset.speedfillFilled = 'true';
      } else {
        const required = input.required ||
                         input.getAttribute('aria-required') === 'true' ||
                         input.closest('[required]') !== null;
        if (required) {
          input.classList.add('speedfill-warning');
          hasUnfilled = true;
        }
      }
    });

    return hasUnfilled;
  }

  /** Answer <select> dropdowns */
  function processDropdowns(modal) {
    modal.querySelectorAll('select').forEach(select => {
      if (select.disabled) return;
      const currentVal = select.value;
      if (currentVal && currentVal !== '' && currentVal !== 'Select an option') return;

      const match = window.SpeedFillMatcher?.matchField(select, profile);
      if (!match?.value) return;

      const options = Array.from(select.options);
      const target = options.find(o =>
        o.text.toLowerCase().includes(match.value.toLowerCase()) ||
        o.value.toLowerCase().includes(match.value.toLowerCase())
      ) || (options.length > 1 ? null : null); // don't blindly pick option[1]

      if (target) {
        setNativeValue(select, target.value);
        select.classList.add('speedfill-highlight');
      }
    });
  }

  /** Answer radio fieldset groups */
  function processRadioGroups(modal) {
    let hasUnfilled = false;

    modal.querySelectorAll('fieldset').forEach(fieldset => {
      const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
      if (radios.length === 0) return;
      if (radios.some(r => r.checked)) return; // already answered

      const legendEl = fieldset.querySelector('legend, .fb-form-element-label');
      const legendText = (legendEl?.textContent || fieldset.textContent || '').toLowerCase().trim();

      let targetValue = null;

      // 1. Q&A bank keywords
      if (Array.isArray(profile.screening)) {
        for (const item of profile.screening) {
          if (!item.keywords) continue;
          const kws = item.keywords.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
          if (kws.some(kw => legendText.includes(kw))) {
            targetValue = item.answer.toLowerCase();
            break;
          }
        }
      }

      // 2. Smart fallbacks for common LinkedIn screening questions
      if (!targetValue) {
        if (/authoriz|legally eligible|work permit|right to work/.test(legendText)) {
          targetValue = 'yes';
        } else if (/require.*sponsor|need.*visa|visa sponsor/.test(legendText)) {
          targetValue = 'no'; // Most candidates don't need sponsorship; user should override via Q&A bank
        } else if (/relocat/.test(legendText)) {
          targetValue = 'yes';
        } else if (/hybrid|remote|on.?site|in.?office/.test(legendText)) {
          // Pick "Yes" if available, otherwise first option
          targetValue = 'yes';
        }
      }

      if (targetValue) {
        // Find the radio whose label best matches targetValue
        const picked = radios.find(r => {
          const labelText = (
            r.labels?.[0]?.textContent ||
            r.closest('label')?.textContent ||
            r.nextElementSibling?.textContent ||
            r.getAttribute('aria-label') ||
            r.value ||
            ''
          ).toLowerCase();
          return labelText.includes(targetValue);
        }) || (targetValue === 'yes' ? radios.find(r => (r.value || '').toLowerCase() === 'yes') : null);

        if (picked) {
          picked.click();
          picked.dispatchEvent(new Event('change', { bubbles: true }));
          fieldset.classList.add('speedfill-highlight');
          fieldset.classList.remove('speedfill-warning');
          return;
        }
      }

      // Required but unmatched
      const requiredMark = fieldset.querySelector('[aria-required="true"], [required]');
      if (requiredMark || legendText) {
        fieldset.classList.add('speedfill-warning');
        hasUnfilled = true;
      }
    });

    return hasUnfilled;
  }

  /** Auto-select first resume card on the resume upload step */
  function processResumeStep(modal) {
    if (!profile.settings?.autoSelectResume) return;

    // LinkedIn resume picker containers
    const pickers = modal.querySelectorAll(
      '.jobs-resume-picker, .jobs-document-upload-redesign, ' +
      '[data-test-resume-picker], .jobs-resume-picker__resume-btn-container'
    );

    pickers.forEach(picker => {
      // Radio-style resume cards
      const radioCard = picker.querySelector('input[type="radio"]:not(:checked)');
      if (radioCard) {
        radioCard.click();
        radioCard.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }

      // Button-style (newer LinkedIn UI)
      const useBtn = picker.querySelector(
        'button[aria-label*="Use"], button[aria-label*="Select"], ' +
        'button.jobs-resume-picker__resume-btn:not(.jobs-resume-picker__resume-btn--selected)'
      );
      if (useBtn) useBtn.click();
    });
  }

  // ─── Step Navigator ─────────────────────────────────────────────────────────

  function advanceNextStep(modal) {
    if (!modal || !modal.isConnected) return;

    // Priority: Submit > Review > Next/Continue
    const submitBtn = modal.querySelector(
      'button[aria-label*="Submit application"], ' +
      'button.jobs-easy-apply-footer__action-btn--submit, ' +
      '[data-easy-apply-submit-button]'
    );

    const reviewBtn = modal.querySelector(
      'button[aria-label*="Review your application"], ' +
      'button.jobs-easy-apply-footer__action-btn--review, ' +
      '[data-easy-apply-review-button]'
    );

    const nextBtn = modal.querySelector(
      'button[aria-label*="Continue to next step"], ' +
      'button.jobs-easy-apply-footer__action-btn--next, ' +
      '[data-easy-apply-next-button], ' +
      'button.artdeco-button--primary:not([disabled]):last-of-type'
    );

    if (submitBtn && !submitBtn.disabled && profile.settings?.autoSubmitApplication) {
      submitBtn.click();
      // Log application
      logApplicationSubmit(modal);
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
      // Dismiss thank-you dialog after a moment
      setTimeout(() => {
        const dismiss = document.querySelector(
          'button[aria-label*="Dismiss"], button.artdeco-modal__dismiss, ' +
          'button[data-test-modal-close-btn]'
        );
        if (dismiss) dismiss.click();
      }, 1200);
      return;
    }

    if (reviewBtn && !reviewBtn.disabled) {
      reviewBtn.click();
      return;
    }

    if (nextBtn && !nextBtn.disabled) {
      nextBtn.click();
      return;
    }

    // "Done" / "Not now" post-submit screen
    const doneBtn = modal.querySelector(
      'button[aria-label*="Dismiss"], button[data-test-modal-close-btn]'
    );
    if (doneBtn) {
      doneBtn.click();
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
    }
  }

  // ─── Application Log ────────────────────────────────────────────────────────

  function logApplicationSubmit(modal) {
    const jobTitle = document.querySelector(
      '.jobs-easy-apply-modal__title, .t-24.t-bold'
    )?.textContent?.trim() || 'Unknown Job';
    const companyName = document.querySelector(
      '.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name'
    )?.textContent?.trim() || 'Unknown Company';

    const entry = {
      jobTitle,
      companyName,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };

    chrome.storage.local.get(['applicationLog'], result => {
      const log = result.applicationLog || [];
      log.unshift(entry);
      // Keep last 500 entries
      chrome.storage.local.set({ applicationLog: log.slice(0, 500) });
    });
  }

  // ─── Main Step Processing ───────────────────────────────────────────────────

  function getModalHash(modal) {
    // Lightweight fingerprint of visible form content to detect step changes
    const inputs = Array.from(modal.querySelectorAll('input, select, textarea, fieldset'));
    return inputs.map(el => el.id || el.name || el.tagName + el.type).join('|');
  }

  function processModalStep() {
    if (processingLock) return;

    const modal = [...document.querySelectorAll(MODAL_SELECTOR)].find(isEasyApplyModal);
    if (!modal) return;

    const hash = getModalHash(modal);
    if (hash === lastModalHash) return; // same step, no need to re-process
    lastModalHash = hash;

    processingLock = true;

    // Fill the step
    const missingInputs = processInputs(modal);
    const missingRadios = processRadioGroups(modal);
    processDropdowns(modal);
    processResumeStep(modal);

    processingLock = false;

    const hasMissing = missingInputs || missingRadios;

    if (hasMissing && profile.settings?.pauseOnUnmatchedFields) {
      window.postMessage({ type: 'SPEEDFILL_REVIEW_NEEDED' }, '*');
      return; // Don't auto-advance
    }

    if (!profile.settings?.autoAdvanceStep) return;

    const delay = Math.max(0, profile.settings?.stepDelayMs ?? 600);
    clearTimeout(stepTimer);
    stepTimer = setTimeout(() => advanceNextStep(modal), delay);
  }

  // ─── MutationObserver (debounced) ──────────────────────────────────────────

  let debounceTimer = null;

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      // Debounce: only react 400ms after the last DOM mutation burst
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!profile) return;
        const modal = [...document.querySelectorAll(MODAL_SELECTOR)].find(isEasyApplyModal);
        if (modal && profile.settings?.autoFillOnLoad) {
          processModalStep();
        }
      }, 400);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false  // don't watch attribute changes to keep it lean
    });
  }

  // ─── Manual-edit lock ────────────────────────────────────────────────────────
  // Mark any field the user physically types into so we never overwrite it
  document.addEventListener('input', e => {
    if (e.target && e.target.matches && e.target.matches('input, textarea')) {
      e.target.dataset.speedfillUserEdited = 'true';
    }
  }, true);

  // ─── Message listener (from background.js hotkey) ──────────────────────────
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRIGGER_AUTOFILL') {
        lastModalHash = ''; // force re-process
        if (profile) {
          processModalStep();
        } else {
          loadProfile(() => processModalStep());
        }
        sendResponse({ status: 'OK' });
        return true;
      }
    });
  }

  // ─── Boot ──────────────────────────────────────────────────────────────────
  function init() {
    loadProfile(() => startObserver());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
