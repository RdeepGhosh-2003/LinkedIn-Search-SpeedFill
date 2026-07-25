/**
 * LinkedIn SpeedFill – Auto-Apply & Learn-on-the-Go Engine v2.0.0
 *
 * Core Features:
 *  1. Triggers instantly when user clicks "Easy Apply" button or modal opens
 *  2. Auto-fills text inputs, dropdowns, radios, checkboxes, and resumes
 *  3. Auto-advances through Next → Review → Submit steps
 *  4. 🧠 "Learn on the Go": Automatically captures user's manual answers for
 *     unfilled questions and saves them to the Q&A bank in storage!
 *  5. Search pill script completely removed for clean focus on Easy Apply
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

  // ─── Searchable Contexts (Handles Iframe Isolation) ─────────────────────────
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

  // ─── Profile Loading ────────────────────────────────────────────────────────
  function loadProfile(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(['userProfile'], result => {
      profile = result.userProfile || getDefaultProfile();
      LOG('Profile loaded:', profile.personal?.fullName || 'Default');
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
        autoFillOnLoad: true, pauseOnUnmatchedFields: false, stepDelayMs: 400,
        autoSelectResume: true, autoAdvanceStep: true, autoSubmitApplication: true,
        highlightFilledFields: true, learnOnTheGo: true
      }
    };
  }

  // ─── React-Aware Native Value Setter ─────────────────────────────────────────
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

  // ─── 🧠 LEARN ON THE GO: Auto-Save Manual User Answers ──────────────────────
  function learnFromUserAnswer(questionText, answerText) {
    if (!profile || profile.settings?.learnOnTheGo === false) return;
    if (!questionText || !answerText) return;

    const cleanedQ = questionText.toLowerCase().replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
    const cleanedA = String(answerText).trim();

    if (!cleanedQ || !cleanedA) return;
    if (cleanedA.toLowerCase() === 'select an option') return;

    // Generate keywords from question
    const words = cleanedQ.split(/\s+/).filter(w =>
      w.length > 2 && !['are', 'you', 'how', 'many', 'the', 'what', 'for', 'with', 'your', 'have', 'does', 'do', 'please'].includes(w)
    );
    const keywords = words.slice(0, 5).join(', ');
    if (!keywords) return;

    if (!Array.isArray(profile.screening)) profile.screening = [];

    // Check if item already exists
    const existing = profile.screening.find(item => {
      const kws = item.keywords.toLowerCase();
      return words.some(w => kws.includes(w));
    });

    if (existing) {
      if (existing.answer !== cleanedA) {
        existing.answer = cleanedA;
        LOG(`🧠 Learn-on-the-Go updated Q&A: "${existing.keywords}" → "${cleanedA}"`);
      } else {
        return; // already saved
      }
    } else {
      profile.screening.push({ keywords, answer: cleanedA });
      LOG(`🧠 Learn-on-the-Go learned new Q&A: "${keywords}" → "${cleanedA}"`);
    }

    // Persist to storage
    chrome.storage.local.set({ userProfile: profile });

    // Show on-screen toast notification
    showSpeedFillToast(`🧠 Learned: "${keywords}" → "${cleanedA}"`);
  }

  function showSpeedFillToast(msg) {
    let toast = document.getElementById('sf-learn-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sf-learn-toast';
      toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        background: #0a66c2; color: #fff; padding: 10px 16px; border-radius: 20px;
        font-family: system-ui, -apple-system, sans-serif; font-size: 12px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3); transition: all 0.3s ease; pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
      }
    }, 2800);
  }

  // ─── Attach Manual Answer Event Listeners for Learn-on-the-Go ──────────────
  function attachLearnListeners(modal) {
    if (modal.dataset.speedfillLearnAttached === 'true') return;
    modal.dataset.speedfillLearnAttached = 'true';

    modal.addEventListener('change', e => {
      const target = e.target;
      if (!target) return;

      // Text input or textarea
      if (target.matches('input[type="text"], input[type="number"], textarea')) {
        const qText = window.SpeedFillMatcher?.getElementLabelText(target);
        if (qText && target.value.trim()) {
          learnFromUserAnswer(qText, target.value.trim());
        }
      }

      // Select dropdown
      if (target.matches('select')) {
        const qText = window.SpeedFillMatcher?.getElementLabelText(target);
        const selOption = target.options[target.selectedIndex];
        if (qText && selOption && selOption.text.trim() && selOption.value !== 'Select an option') {
          learnFromUserAnswer(qText, selOption.text.trim());
        }
      }

      // Radio button
      if (target.matches('input[type="radio"]')) {
        const fieldset = target.closest('fieldset');
        const legend   = fieldset?.querySelector('legend, .fb-form-element-label');
        const qText    = legend?.textContent || fieldset?.textContent || '';
        const radioLbl = Array.from(target.labels || [])[0]?.textContent || target.nextElementSibling?.textContent || target.value;
        if (qText && radioLbl) {
          learnFromUserAnswer(qText, radioLbl.trim());
        }
      }
    }, true);
  }

  // ─── Form Filling Processors ────────────────────────────────────────────────

  function processInputs(modal) {
    let hasUnfilled = false;
    const inputs = queryShadowAll(modal,
      'input[type="text"], input[type="number"], input[type="email"], ' +
      'input[type="tel"], input:not([type]), textarea'
    );

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
        const isRequired = input.required || input.getAttribute('aria-required') === 'true';
        if (isRequired) {
          input.classList.add('speedfill-warning');
          hasUnfilled = true;
        }
      }
    }
    return hasUnfilled;
  }

  function processDropdowns(modal) {
    const selects = queryShadowAll(modal, 'select');

    for (const select of selects) {
      if (select.disabled) continue;
      const curVal = (select.value || '').trim();
      if (curVal && curVal !== '' && curVal !== 'Select an option') continue;

      const match = window.SpeedFillMatcher?.matchField(select, profile);
      if (!match?.value) continue;

      const targetVal = match.value.toLowerCase().trim();
      const options = Array.from(select.options);

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

  function processRadioGroups(modal) {
    let hasUnfilled = false;
    const fieldsets = queryShadowAll(modal, 'fieldset');

    for (const fieldset of fieldsets) {
      const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
      if (radios.length === 0) continue;
      if (radios.some(r => r.checked)) continue;

      const legendEl   = fieldset.querySelector('legend, .fb-form-element-label, span.t-14');
      const legendText = (legendEl?.textContent || fieldset.textContent || '').toLowerCase().slice(0, 200);
      let targetValue  = null;

      // Q&A bank match
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
          LOG(`Radio answered: "${legendText.slice(0,35)}" → "${targetValue}"`);
        } else {
          hasUnfilled = true;
        }
      } else {
        const hasRequired = fieldset.querySelector('[aria-required="true"]');
        if (hasRequired) hasUnfilled = true;
      }
    }
    return hasUnfilled;
  }

  function processCheckboxes(modal) {
    // Auto-check terms / agreement checkboxes if required
    const checkboxes = queryShadowAll(modal, 'input[type="checkbox"]:not(:checked)');
    checkboxes.forEach(cb => {
      const isRequired = cb.required || cb.getAttribute('aria-required') === 'true';
      const labelText  = (cb.labels?.[0]?.textContent || cb.closest('label')?.textContent || '').toLowerCase();
      if (isRequired || /agree|terms|consent|certify|acknowledge/.test(labelText)) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
        LOG('Agreement checkbox auto-checked');
      }
    });
  }

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
        LOG('Resume selected');
        return;
      }
    }

    const useBtn = queryShadowFirst(modal,
      'button[aria-label*="Use"], button[aria-label*="Select resume"]'
    );
    if (useBtn) { useBtn.click(); LOG('Resume button clicked'); }
  }

  // ─── Find Action Button (Next / Review / Submit) ───────────────────────────
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

      // Exclude close/dismiss button
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

  // ─── Step Navigator & Auto-Advancement ──────────────────────────────────────
  function advanceNextStep(modal) {
    if (!modal?.isConnected) return;

    const { submitBtn, reviewBtn, nextBtn } = findActionButton(modal);

    LOG(`Action buttons found — submit:${!!submitBtn} review:${!!reviewBtn} next:${!!nextBtn}`);

    if (submitBtn && profile?.settings?.autoSubmitApplication !== false) {
      LOG('🚀 Submitting application');
      submitBtn.click();
      logApplicationSubmit();
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
      setTimeout(() => {
        const dismiss = document.querySelector(
          'button[aria-label="Dismiss"], .artdeco-modal__dismiss, button[data-test-modal-close-btn]'
        );
        if (dismiss) dismiss.click();
      }, 1200);
      return;
    }

    if (reviewBtn) { LOG('Clicking Review step'); reviewBtn.click(); return; }
    if (nextBtn)   { LOG('Clicking Next step');   nextBtn.click();   return; }

    LOG('No action button to click on this step');
  }

  // ─── Application Logging ────────────────────────────────────────────────────
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

  // ─── Main Step Processor ────────────────────────────────────────────────────
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

    // Attach Learn-on-the-Go manual input listeners
    attachLearnListeners(modal);

    const hash = getModalHash(modal);
    if (hash === lastModalHash) return;
    lastModalHash = hash;

    processingLock = true;
    try {
      const missingInputs = processInputs(modal);
      const missingRadios = processRadioGroups(modal);
      processDropdowns(modal);
      processCheckboxes(modal);
      processResumeStep(modal);

      const hasMissing = missingInputs || missingRadios;

      if (hasMissing && profile?.settings?.pauseOnUnmatchedFields) {
        LOG('Pausing due to missing required fields (pauseOnUnmatchedFields is enabled)');
        window.postMessage({ type: 'SPEEDFILL_REVIEW_NEEDED' }, '*');
        return;
      }

      if (profile?.settings?.autoAdvanceStep !== false) {
        const delay = Math.max(0, profile.settings?.stepDelayMs ?? 400);
        clearTimeout(stepTimer);
        stepTimer = setTimeout(() => advanceNextStep(modal), delay);
      }
    } finally {
      processingLock = false;
    }
  }

  // ─── Global Easy Apply Click Interceptor ───────────────────────────────────
  function attachEasyApplyClickListener() {
    document.addEventListener('click', e => {
      const target = e.target;
      if (!target) return;

      const isEasyApply = (
        target.textContent?.includes('Easy Apply') ||
        target.getAttribute('aria-label')?.includes('Easy Apply') ||
        target.closest('.jobs-apply-button') ||
        target.closest('[data-job-apply-button]')
      );

      if (isEasyApply) {
        LOG('User clicked Easy Apply button — initializing instant fill loop');
        lastModalHash = '';
        // Poll for modal opening
        [150, 400, 800, 1200, 1800].forEach(delay => {
          setTimeout(processModalStep, delay);
        });
      }
    }, true);
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
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ─── Manual-Edit Lock ────────────────────────────────────────────────────────
  document.addEventListener('input', e => {
    if (e.target?.matches?.('input, textarea')) {
      e.target.dataset.speedfillUserEdited = 'true';
    }
  }, true);

  // ─── Message Listener (Alt+F Hotkey) ────────────────────────────────────────
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRIGGER_AUTOFILL') {
        LOG('Autofill manually triggered via Alt+F');
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
    LOG('SpeedFill Auto-Apply Engine v2.0.0 initialized');
    attachEasyApplyClickListener();
    loadProfile(() => startObserver());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
