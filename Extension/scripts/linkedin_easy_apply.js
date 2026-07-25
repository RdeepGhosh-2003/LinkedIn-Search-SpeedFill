/**
 * LinkedIn SpeedFill – Easy Apply Modal Engine v1.2.1
 * Verified against live July 2026 LinkedIn Easy Apply DOM & Accessibility Tree
 */

(function () {
  'use strict';

  const LOG = (...args) => console.log('[SpeedFill]', ...args);

  // ─── State ─────────────────────────────────────────────────────────────────
  let profile        = null;
  let observer       = null;
  let stepTimer      = null;
  let lastModalHash  = '';
  let processingLock = false;
  let debounceTimer  = null;

  // ─── Shadow DOM & Iframe Context Helpers ────────────────────────────────────

  function getSearchableContexts() {
    const contexts = [document];
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try {
          if (iframe.contentDocument && iframe.contentDocument.body) {
            contexts.push(iframe.contentDocument);
          }
        } catch(e) {}
      });
    } catch(e) {}
    return contexts;
  }

  function queryShadowAll(root, selector) {
    const results = [];
    try {
      results.push(...Array.from(root.querySelectorAll(selector)));
    } catch(e) {}

    const allEls = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
    for (const el of allEls) {
      if (el.shadowRoot) {
        results.push(...queryShadowAll(el.shadowRoot, selector));
      }
    }
    return results;
  }

  function queryShadowFirst(root, selector) {
    return queryShadowAll(root, selector)[0] || null;
  }

  // ─── Modal Detection ────────────────────────────────────────────────────────
  function findEasyApplyModal() {
    const contexts = getSearchableContexts();

    for (const ctx of contexts) {
      // Strategy 1: class-based
      const byClass = ctx.querySelector('.jobs-easy-apply-modal');
      if (byClass) return byClass;

      // Strategy 2: role="dialog" or artdeco-modal with Easy Apply title/aria-label
      const allModals = ctx.querySelectorAll(
        'div[role="dialog"], .artdeco-modal, [data-test-modal]'
      );

      for (const modal of allModals) {
        const ariaLabel = (modal.getAttribute('aria-label') || '').toLowerCase();
        if (ariaLabel.includes('easy apply') || ariaLabel.includes('apply to')) {
          return modal;
        }
        const heading = modal.querySelector('h1, h2, h3, h4, [class*="title"]');
        if (heading?.textContent?.toLowerCase().includes('easy apply') ||
            heading?.textContent?.toLowerCase().includes('apply to')) {
          return modal;
        }
      }

      // Strategy 3: footer presence
      const footers = ctx.querySelectorAll('.jobs-easy-apply-footer, [class*="easy-apply-footer"]');
      if (footers.length > 0) {
        return footers[0].closest('div[role="dialog"], .artdeco-modal') || footers[0].parentElement;
      }

      // Strategy 4: Shadow DOM search
      const shadowModal = queryShadowFirst(ctx.body || ctx, '.jobs-easy-apply-modal');
      if (shadowModal) return shadowModal;
    }

    return null;
  }

  // ─── Profile loading ────────────────────────────────────────────────────────
  function loadProfile(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      LOG('chrome.storage unavailable');
      return;
    }
    chrome.storage.local.get(['userProfile'], result => {
      profile = result.userProfile || null;
      if (profile) {
        LOG('Profile loaded:', profile.personal?.fullName);
      } else {
        LOG('No profile found in storage');
      }
      if (callback) callback();
    });
  }

  // ─── React-aware value setter ───────────────────────────────────────────────
  function setNativeValue(el, value) {
    try {
      const proto  = Object.getPrototypeOf(el);
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set ||
                     Object.getOwnPropertyDescriptor(el, 'value')?.set;
      if (setter) {
        setter.call(el, value);
      } else {
        el.value = value;
      }
    } catch(e) {
      el.value = value;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  }

  // ─── Fill text inputs ───────────────────────────────────────────────────────
  function processInputs(modal) {
    let hasUnfilled = false;

    const inputs = queryShadowAll(modal,
      'input[type="text"], input[type="number"], input[type="email"], ' +
      'input[type="tel"], input:not([type]), textarea'
    );

    LOG(`Found ${inputs.length} inputs in modal`);

    for (const input of inputs) {
      if (input.dataset.speedfillUserEdited === 'true') continue;
      if (input.value?.trim()) continue;
      if (input.hidden || input.disabled || input.readOnly) continue;

      const match = window.SpeedFillMatcher?.matchField(input, profile);
      if (match?.value) {
        setNativeValue(input, match.value);
        if (profile?.settings?.highlightFilledFields) {
          input.classList.add('speedfill-highlight');
        }
        input.dataset.speedfillFilled = 'true';
        LOG(`Filled input "${match.keyMatched}" → "${match.value}"`);
      } else {
        const isRequired = input.required ||
                           input.getAttribute('aria-required') === 'true';
        if (isRequired) {
          input.classList.add('speedfill-warning');
          hasUnfilled = true;
          LOG(`Required input unmatched:`, input.id || input.name || input.placeholder || input.getAttribute('aria-label'));
        }
      }
    }
    return hasUnfilled;
  }

  // ─── Fill select dropdowns ──────────────────────────────────────────────────
  function processDropdowns(modal) {
    const selects = queryShadowAll(modal, 'select');
    LOG(`Found ${selects.length} dropdown selects in modal`);

    for (const select of selects) {
      if (select.disabled) continue;
      const curVal = (select.value || '').trim();
      if (curVal && curVal !== '' && curVal !== 'Select an option') continue;

      const match = window.SpeedFillMatcher?.matchField(select, profile);
      if (!match?.value) continue;

      const targetVal = match.value.toLowerCase().trim();
      const options = Array.from(select.options);

      // Find matching option ignoring extra padding whitespace
      const target = options.find(o => {
        const txt = o.text.toLowerCase().trim();
        const val = o.value.toLowerCase().trim();
        return txt.includes(targetVal) || val.includes(targetVal);
      });

      if (target) {
        setNativeValue(select, target.value);
        select.classList.add('speedfill-highlight');
        LOG(`Dropdown filled: "${match.keyMatched}" → "${target.text.trim()}"`);
      }
    }
  }

  // ─── Answer radio groups ────────────────────────────────────────────────────
  function processRadioGroups(modal) {
    let hasUnfilled = false;
    const fieldsets = queryShadowAll(modal, 'fieldset');

    LOG(`Found ${fieldsets.length} fieldsets`);

    for (const fieldset of fieldsets) {
      const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
      if (radios.length === 0) continue;
      if (radios.some(r => r.checked)) continue;

      const legendEl   = fieldset.querySelector('legend, .fb-form-element-label, span.t-14');
      const legendText = (legendEl?.textContent || fieldset.textContent || '').toLowerCase().slice(0, 200);
      let targetValue  = null;

      // Q&A bank
      if (Array.isArray(profile?.screening)) {
        for (const item of profile.screening) {
          if (!item.keywords) continue;
          const kws = item.keywords.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
          if (kws.some(kw => legendText.includes(kw))) {
            targetValue = item.answer.toLowerCase();
            break;
          }
        }
      }

      // Smart fallbacks
      if (!targetValue) {
        if (/authoriz|legally eligible|right to work|work permit/.test(legendText)) targetValue = 'yes';
        else if (/require.*sponsor|need.*visa|visa sponsor/.test(legendText))       targetValue = 'no';
        else if (/relocat/.test(legendText))                                        targetValue = 'yes';
        else if (/hybrid|remote|on.?site|in.?person/.test(legendText))              targetValue = 'yes';
        else if (/currently.*work|still.*employ/.test(legendText))                  targetValue = 'yes';
      }

      if (targetValue) {
        const picked = radios.find(r => {
          const lbl = (
            Array.from(r.labels || [])[0]?.textContent ||
            r.closest('label')?.textContent ||
            r.nextElementSibling?.textContent ||
            r.getAttribute('aria-label') ||
            r.value || ''
          ).toLowerCase();
          return lbl.includes(targetValue);
        });

        if (picked) {
          picked.click();
          picked.dispatchEvent(new Event('change', { bubbles: true }));
          fieldset.classList.add('speedfill-highlight');
          LOG(`Radio answered: "${legendText.slice(0,40)}" → "${targetValue}"`);
        } else {
          LOG(`Radio no option match for "${targetValue}"`);
          hasUnfilled = true;
        }
      } else {
        LOG(`Radio unmatched (no fallback): "${legendText.slice(0,40)}"`);
        const hasRequired = fieldset.querySelector('[aria-required="true"]');
        if (hasRequired) hasUnfilled = true;
      }
    }
    return hasUnfilled;
  }

  // ─── Auto-select resume ─────────────────────────────────────────────────────
  function processResumeStep(modal) {
    if (!profile?.settings?.autoSelectResume) return;

    const resumeSelectors = [
      '.jobs-resume-picker input[type="radio"]:not(:checked)',
      '.jobs-document-upload-redesign input[type="radio"]:not(:checked)',
      '[data-test-resume-card] input[type="radio"]:not(:checked)',
      'input[name="resume"]:not(:checked)',
      '.artdeco-card input[type="radio"]:not(:checked)'
    ];

    for (const sel of resumeSelectors) {
      const radioCards = queryShadowAll(modal, sel);
      if (radioCards.length > 0) {
        radioCards[0].click();
        radioCards[0].dispatchEvent(new Event('change', { bubbles: true }));
        LOG('Resume selected via radio card');
        return;
      }
    }

    const useBtn = queryShadowFirst(modal,
      'button[aria-label*="Use"], button[aria-label*="Select resume"]'
    );
    if (useBtn) { useBtn.click(); LOG('Resume button clicked'); }
  }

  // ─── Find Next / Review / Submit button ─────────────────────────────────────
  function findActionButton(modal) {
    const doc = modal.ownerDocument || document;

    const candidates = [
      ...queryShadowAll(modal, 'button'),
      ...queryShadowAll(doc, 'button[aria-label="Continue to next step"], button[aria-label*="Submit"], button[aria-label*="Review"]')
    ];

    const uniqueCandidates = Array.from(new Set(candidates));

    let nextBtn   = null;
    let reviewBtn = null;
    let submitBtn = null;

    for (const btn of uniqueCandidates) {
      if (btn.disabled) continue;
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase().trim();
      const text      = (btn.textContent || '').toLowerCase().trim();

      // EXCLUDE Dismiss / Close button
      if (ariaLabel === 'dismiss' || ariaLabel.includes('close modal') || text === 'dismiss') continue;

      if (ariaLabel.includes('submit application') || ariaLabel.includes('submit your application') || text === 'submit application') {
        submitBtn = btn;
      } else if (ariaLabel.includes('review your application') || ariaLabel.includes('review') || text === 'review') {
        reviewBtn = btn;
      } else if (
        ariaLabel === 'continue to next step' ||
        ariaLabel.includes('next step') ||
        ariaLabel.includes('continue') ||
        text === 'next' ||
        text === 'continue'
      ) {
        nextBtn = btn;
      }
    }

    return { submitBtn, reviewBtn, nextBtn };
  }

  // ─── Advance step ───────────────────────────────────────────────────────────
  function advanceNextStep(modal) {
    if (!modal?.isConnected) return;

    const { submitBtn, reviewBtn, nextBtn } = findActionButton(modal);

    LOG(`Action buttons found — submit:${!!submitBtn} review:${!!reviewBtn} next:${!!nextBtn}`);

    if (submitBtn && profile?.settings?.autoSubmitApplication) {
      LOG('Clicking Submit button');
      submitBtn.click();
      logApplicationSubmit();
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
      setTimeout(() => {
        const dismiss = document.querySelector(
          'button[aria-label="Dismiss"], .artdeco-modal__dismiss, button[data-test-modal-close-btn]'
        );
        if (dismiss) dismiss.click();
      }, 1500);
      return;
    }

    if (reviewBtn) { LOG('Clicking Review button'); reviewBtn.click(); return; }
    if (nextBtn)   { LOG('Clicking Next button');   nextBtn.click();   return; }

    LOG('No action button found to click');
  }

  // ─── Application log ────────────────────────────────────────────────────────
  function logApplicationSubmit() {
    const jobTitle = document.querySelector(
      '.jobs-easy-apply-modal h2, .t-24, .jobs-unified-top-card__job-title'
    )?.textContent?.trim() || 'LinkedIn Job';
    const company = document.querySelector(
      '.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name'
    )?.textContent?.trim() || 'LinkedIn Company';

    chrome.storage.local.get(['applicationLog'], result => {
      const log = result.applicationLog || [];
      log.unshift({ jobTitle, company, url: location.href, timestamp: new Date().toISOString() });
      chrome.storage.local.set({ applicationLog: log.slice(0, 500) });
    });
  }

  // ─── Main step processor ────────────────────────────────────────────────────
  function getModalHash(modal) {
    try {
      const els = Array.from(modal.querySelectorAll('input, select, textarea, fieldset, button'));
      return els.map(e => (e.id || e.name || e.tagName + (e.type || ''))).join('|');
    } catch(e) { return Date.now().toString(); }
  }

  function processModalStep() {
    if (processingLock) return;
    if (!profile) {
      loadProfile(() => processModalStep());
      return;
    }

    const modal = findEasyApplyModal();
    if (!modal) return;

    LOG('Easy Apply modal active in document context');

    const hash = getModalHash(modal);
    if (hash === lastModalHash) return;
    lastModalHash = hash;

    processingLock = true;
    try {
      const missingInputs = processInputs(modal);
      const missingRadios = processRadioGroups(modal);
      processDropdowns(modal);
      processResumeStep(modal);

      const hasMissing = missingInputs || missingRadios;
      LOG(`Step processed — unmatched fields remaining: ${hasMissing}`);

      if (hasMissing && profile?.settings?.pauseOnUnmatchedFields) {
        window.postMessage({ type: 'SPEEDFILL_REVIEW_NEEDED' }, '*');
        return;
      }

      if (profile?.settings?.autoAdvanceStep) {
        const delay = Math.max(0, profile.settings.stepDelayMs ?? 600);
        clearTimeout(stepTimer);
        stepTimer = setTimeout(() => advanceNextStep(modal), delay);
      }
    } finally {
      processingLock = false;
    }
  }

  // ─── MutationObserver ───────────────────────────────────────────────────────
  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!profile?.settings?.autoFillOnLoad) return;
        const modal = findEasyApplyModal();
        if (modal) processModalStep();
      }, 350);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    LOG('SpeedFill Observer active');
  }

  // ─── Manual-edit lock ────────────────────────────────────────────────────────
  document.addEventListener('input', e => {
    if (e.target?.matches?.('input, textarea')) {
      e.target.dataset.speedfillUserEdited = 'true';
    }
  }, true);

  // ─── Message listener (Alt+F hotkey) ────────────────────────────────────────
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRIGGER_AUTOFILL') {
        LOG('Autofill manually triggered');
        lastModalHash = '';
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
    LOG('SpeedFill Easy Apply Engine v1.2.1 initialized on frame:', location.href);
    loadProfile(() => startObserver());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
