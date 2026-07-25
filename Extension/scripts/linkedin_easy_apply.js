/**
 * LinkedIn SpeedFill – Auto-Fill & Step Navigator Engine v2.1.0
 * Architecture aligned 100% with the ultra-fast Indeed SpeedFill engine.
 */

(function () {
  'use strict';

  const LOG = (...args) => console.log('[SpeedFill]', ...args);

  let userProfile        = null;
  let isObserverActive   = false;
  let stepTimer          = null;
  let autoLoopInterval   = null;

  // ─── Profile Loading & Storage Watcher ──────────────────────────────────────
  function loadProfile(callback) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
    chrome.storage.local.get(['userProfile'], result => {
      if (result && result.userProfile) {
        userProfile = result.userProfile;
        LOG('User profile loaded:', userProfile.personal?.fullName || 'Active');
      } else {
        fetch(chrome.runtime.getURL('data/default_profile.json'))
          .then(res => res.json())
          .then(data => {
            userProfile = data;
            chrome.storage.local.set({ userProfile: data });
          })
          .catch(err => console.error('[SpeedFill] Error loading default profile:', err));
      }
      if (callback) callback();
    });
  }

  // Real-time sync when user updates profile in popup
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.userProfile) {
        userProfile = changes.userProfile.newValue;
        LOG('Profile updated in real-time');
      }
    });
  }

  // ─── Native Event Dispatchers (React state update) ──────────────────────────
  function setReactInputValue(el, value) {
    if (!el || value === undefined || value === null) return false;
    if (el.disabled || el.readOnly || el.dataset.speedfillUserEdited === 'true') return false;

    const valStr = String(value);
    if (el.value === valStr) return false;

    try {
      const isTextArea = el.tagName.toLowerCase() === 'textarea';
      const proto = isTextArea ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (setter) {
        setter.call(el, valStr);
      } else {
        el.value = valStr;
      }
    } catch(e) {
      el.value = valStr;
    }

    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));

    if (userProfile?.settings?.highlightFilledFields !== false) {
      el.classList.add('speedfill-highlight');
    }

    return true;
  }

  function setSelectValue(selectEl, value) {
    if (!selectEl || !value || selectEl.disabled || selectEl.dataset.speedfillUserEdited === 'true') return false;

    const targetVal = String(value).toLowerCase().trim();
    let matchedOption = null;

    for (const option of selectEl.options) {
      const optText = option.textContent.toLowerCase().trim();
      const optVal  = option.value.toLowerCase().trim();
      if (optText.includes(targetVal) || optVal.includes(targetVal) || targetVal.includes(optText)) {
        matchedOption = option;
        break;
      }
    }

    if (matchedOption) {
      selectEl.value = matchedOption.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      selectEl.dispatchEvent(new Event('blur',   { bubbles: true }));
      if (userProfile?.settings?.highlightFilledFields !== false) {
        selectEl.classList.add('speedfill-highlight');
      }
      return true;
    }
    return false;
  }

  // ─── Smart Radio & Screening Question Handler ──────────────────────────────
  function handleRadioGroups() {
    if (!userProfile) return 0;

    let filledCount = 0;
    const containers = document.querySelectorAll('fieldset, [role="radiogroup"], .fb-dash-form-element, [class*="form-element"]');

    containers.forEach(container => {
      const radioInputs = Array.from(container.querySelectorAll('input[type="radio"]'));
      if (radioInputs.length === 0) return;

      // Skip if already selected
      if (radioInputs.some(r => r.checked)) return;

      const headerEl = container.querySelector('legend, h1, h2, h3, h4, label, [class*="label"], span.t-14');
      const questionText = headerEl ? headerEl.textContent.toLowerCase().trim() : container.textContent.toLowerCase().trim();

      let targetValue = null;

      // Q&A Bank
      if (userProfile.screening && Array.isArray(userProfile.screening)) {
        for (const item of userProfile.screening) {
          if (!item.keywords) continue;
          const kws = item.keywords.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
          if (kws.some(kw => questionText.includes(kw))) {
            targetValue = item.answer.toLowerCase();
            break;
          }
        }
      }

      // Fallbacks for common screening questions
      if (!targetValue) {
        if (/authoriz|legally eligible|right to work|work permit/.test(questionText)) targetValue = 'yes';
        else if (/require.*sponsor|need.*visa|visa sponsor/.test(questionText))       targetValue = 'no';
        else if (/relocat/.test(questionText))                                        targetValue = 'yes';
        else if (/hybrid|remote|on.?site|in.?person/.test(questionText))              targetValue = 'yes';
        else if (/currently.*work|still.*employ/.test(questionText))                  targetValue = 'yes';
        else if (/years of experience|experience/.test(questionText))                 targetValue = 'yes';
      }

      if (targetValue) {
        const targetRadio = radioInputs.find(r => {
          const lbl = (
            Array.from(r.labels || [])[0]?.textContent ||
            r.closest('label')?.textContent ||
            r.nextElementSibling?.textContent ||
            r.getAttribute('aria-label') ||
            r.value || ''
          ).toLowerCase();
          return lbl.includes(targetValue);
        });

        if (targetRadio) {
          targetRadio.click();
          targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
          filledCount++;
        }
      }
    });

    return filledCount;
  }

  // ─── Auto-Select Resume ─────────────────────────────────────────────────────
  function handleResumeStep() {
    const resumeCards = Array.from(document.querySelectorAll(
      '.jobs-resume-picker input[type="radio"]:not(:checked), ' +
      '[data-test-resume-card] input[type="radio"]:not(:checked), ' +
      'input[name="resume"]:not(:checked)'
    ));

    if (resumeCards.length > 0) {
      resumeCards[0].click();
      resumeCards[0].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const useBtn = document.querySelector('button[aria-label*="Use"], button[aria-label*="Select resume"]');
    if (useBtn) {
      useBtn.click();
      return true;
    }

    return false;
  }

  // ─── Auto-Check Agreement Checkboxes ────────────────────────────────────────
  function handleCheckboxes() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]:not(:checked)');
    checkboxes.forEach(cb => {
      const isRequired = cb.required || cb.getAttribute('aria-required') === 'true';
      const labelText  = (cb.labels?.[0]?.textContent || cb.closest('label')?.textContent || '').toLowerCase();
      if (isRequired || /agree|terms|consent|certify|acknowledge/.test(labelText)) {
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  // ─── 🧠 LEARN ON THE GO ────────────────────────────────────────────────────
  function learnFromUserAnswer(questionText, answerText) {
    if (!userProfile || userProfile.settings?.learnOnTheGo === false) return;
    if (!questionText || !answerText) return;

    const cleanedQ = questionText.toLowerCase().replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
    const cleanedA = String(answerText).trim();

    if (!cleanedQ || !cleanedA || cleanedA.toLowerCase() === 'select an option') return;

    const words = cleanedQ.split(/\s+/).filter(w =>
      w.length > 2 && !['are', 'you', 'how', 'many', 'the', 'what', 'for', 'with', 'your', 'have', 'does', 'do', 'please'].includes(w)
    );
    const keywords = words.slice(0, 5).join(', ');
    if (!keywords) return;

    if (!Array.isArray(userProfile.screening)) userProfile.screening = [];

    const existing = userProfile.screening.find(item => {
      const kws = item.keywords.toLowerCase();
      return words.some(w => kws.includes(w));
    });

    if (existing) {
      if (existing.answer !== cleanedA) {
        existing.answer = cleanedA;
        LOG(`🧠 Learned update: "${existing.keywords}" → "${cleanedA}"`);
      } else {
        return;
      }
    } else {
      userProfile.screening.push({ keywords, answer: cleanedA });
      LOG(`🧠 Learned new Q&A: "${keywords}" → "${cleanedA}"`);
    }

    chrome.storage.local.set({ userProfile });
    showLearnToast(`🧠 Learned: "${keywords}" → "${cleanedA}"`);
  }

  function showLearnToast(msg) {
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
    setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 2600);
  }

  function attachLearnListeners() {
    const modal = document.querySelector('.jobs-easy-apply-modal, div[role="dialog"], .artdeco-modal') || document.body;
    if (modal.dataset.speedfillLearnAttached) return;
    modal.dataset.speedfillLearnAttached = 'true';

    modal.addEventListener('change', e => {
      const target = e.target;
      if (!target) return;

      if (target.matches('input[type="text"], input[type="number"], textarea')) {
        const qText = window.SpeedFillMatcher?.getElementLabelText(target);
        if (qText && target.value.trim()) learnFromUserAnswer(qText, target.value.trim());
      }
      if (target.matches('select')) {
        const qText = window.SpeedFillMatcher?.getElementLabelText(target);
        const selOpt = target.options[target.selectedIndex];
        if (qText && selOpt && selOpt.text.trim() && selOpt.value !== 'Select an option') {
          learnFromUserAnswer(qText, selOpt.text.trim());
        }
      }
      if (target.matches('input[type="radio"]')) {
        const fieldset = target.closest('fieldset');
        const legend   = fieldset?.querySelector('legend, .fb-form-element-label');
        const qText    = legend?.textContent || fieldset?.textContent || '';
        const radioLbl = Array.from(target.labels || [])[0]?.textContent || target.nextElementSibling?.textContent || target.value;
        if (qText && radioLbl) learnFromUserAnswer(qText, radioLbl.trim());
      }
    }, true);
  }

  // ─── STEP NAVIGATOR: Click Next / Review / Submit ───────────────────────────
  function clickContinueButton() {
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a[role="button"]'));

    const continueBtn = buttons.find(b => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;

      const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase().trim();
      const text      = (b.textContent || '').toLowerCase().trim();

      // Exclude Close/Dismiss buttons
      if (ariaLabel === 'dismiss' || ariaLabel.includes('close modal') || text === 'dismiss') return false;

      return (
        ariaLabel === 'continue to next step' ||
        ariaLabel.includes('next step') ||
        ariaLabel.includes('continue') ||
        ariaLabel.includes('review') ||
        text === 'next' ||
        text === 'continue' ||
        text.includes('next') ||
        text.includes('continue') ||
        text.includes('review') ||
        b.classList.contains('artdeco-button--primary')
      );
    });

    if (continueBtn) {
      LOG('Auto-advancing step via button:', continueBtn.getAttribute('aria-label') || continueBtn.textContent.trim());
      continueBtn.click();
      return true;
    }
    return false;
  }

  function clickSubmitButton() {
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"]'));

    const submitBtn = buttons.find(b => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;

      const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase().trim();
      const text      = (b.textContent || '').toLowerCase().trim();

      if (ariaLabel === 'dismiss' || text === 'dismiss') return false;

      return (
        ariaLabel.includes('submit application') ||
        ariaLabel.includes('submit your application') ||
        text.includes('submit application') ||
        text.includes('submit your application') ||
        text === 'submit'
      );
    });

    if (submitBtn) {
      LOG('Auto-submitting application via button:', submitBtn.getAttribute('aria-label') || submitBtn.textContent.trim());
      logApplicationSubmit();
      submitBtn.click();

      setTimeout(() => {
        const dismiss = document.querySelector('button[aria-label="Dismiss"], .artdeco-modal__dismiss, button[data-test-modal-close-btn]');
        if (dismiss) dismiss.click();
      }, 1200);
      return true;
    }
    return false;
  }

  function logApplicationSubmit() {
    const jobTitle = document.querySelector('.jobs-easy-apply-modal h2, .t-24, .jobs-unified-top-card__job-title')?.textContent?.trim() || 'LinkedIn Job';
    const company  = document.querySelector('.jobs-unified-top-card__company-name, .job-details-jobs-unified-top-card__company-name')?.textContent?.trim() || 'LinkedIn Company';

    chrome.storage.local.get(['applicationLog'], result => {
      const log = result.applicationLog || [];
      log.unshift({ jobTitle, company, url: location.href, timestamp: new Date().toISOString() });
      chrome.storage.local.set({ applicationLog: log.slice(0, 500) });
    });
  }

  // ─── CORE FORM FILLING LOOP ────────────────────────────────────────────────
  function fillCurrentForm() {
    if (!userProfile) {
      loadProfile(() => fillCurrentForm());
      return 0;
    }

    attachLearnListeners();

    let filledCount = 0;

    // 1. Handle Resume step
    const handledResume = handleResumeStep();

    // 2. Handle Checkboxes
    handleCheckboxes();

    // 3. Handle Radio groups
    filledCount += handleRadioGroups();

    // 4. Handle Text inputs, textarea, numbers
    const inputs = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), textarea'
    );
    inputs.forEach(input => {
      if (input.offsetWidth === 0 && input.offsetHeight === 0) return;
      const match = window.SpeedFillMatcher?.matchField(input, userProfile);
      if (match && match.value) {
        if (setReactInputValue(input, match.value)) filledCount++;
      }
    });

    // 5. Handle Select dropdowns
    const selects = document.querySelectorAll('select');
    selects.forEach(select => {
      if (select.offsetWidth === 0 && select.offsetHeight === 0) return;
      const match = window.SpeedFillMatcher?.matchField(select, userProfile);
      if (match && match.value) {
        if (setSelectValue(select, match.value)) filledCount++;
      }
    });

    if (filledCount > 0) {
      LOG(`Auto-filled ${filledCount} field(s) on current step`);
    }

    const stepDelay = userProfile?.settings?.stepDelayMs ?? 200;

    // 6. Check for Submit button first
    if (userProfile?.settings?.autoSubmitApplication !== false) {
      const submitted = clickSubmitButton();
      if (submitted) return filledCount;
    }

    // 7. Auto-advance intermediate steps (Next / Continue / Review)
    if (userProfile?.settings?.autoAdvanceStep !== false) {
      setTimeout(clickContinueButton, stepDelay);
    }

    return filledCount;
  }

  // ─── FAST OBSERVER & EVENT LISTENERS ───────────────────────────────────────
  function setupDOMObserver() {
    if (isObserverActive) return;

    const observer = new MutationObserver(() => {
      clearTimeout(window._speedfillTimer);
      window._speedfillTimer = setTimeout(() => {
        if (userProfile?.settings?.autoFillOnLoad !== false) {
          fillCurrentForm();
        }
      }, 50); // Ultra-fast 50ms debounce matching Indeed engine
    });

    observer.observe(document.body, { childList: true, subtree: true });
    isObserverActive = true;
  }

  // Trigger fill when user clicks anywhere inside an Easy Apply modal or button
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    const isApplyBtn = target.textContent?.includes('Easy Apply') ||
                       target.getAttribute('aria-label')?.includes('Easy Apply') ||
                       target.closest('.jobs-apply-button');

    if (isApplyBtn) {
      LOG('User clicked Easy Apply button — initiating fast fill loop');
      [100, 300, 600, 1000, 1500].forEach(delay => {
        setTimeout(fillCurrentForm, delay);
      });
    }

    // When user clicks radio / select inside modal, trigger auto-advance check
    if (target.matches('input[type="radio"], input[type="checkbox"], option')) {
      setTimeout(fillCurrentForm, 150);
    }
  }, true);

  // User manual input listener to clear userEdited lock if cleared
  document.addEventListener('input', e => {
    if (e.target?.matches?.('input, textarea')) {
      if (e.target.value.trim()) {
        e.target.dataset.speedfillUserEdited = 'true';
      }
    }
  }, true);

  // Alt+F Hotkey trigger
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRIGGER_AUTOFILL') {
        LOG('Alt+F hotkey triggered');
        if (userProfile) {
          fillCurrentForm();
        } else {
          loadProfile(() => fillCurrentForm());
        }
        sendResponse({ status: 'OK' });
        return true;
      }
    });
  }

  // ─── BOOT ──────────────────────────────────────────────────────────────────
  function init() {
    LOG('SpeedFill Auto-Apply Engine v2.1.0 (Indeed Architecture) initialized');
    loadProfile(() => {
      setupDOMObserver();
      fillCurrentForm();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
