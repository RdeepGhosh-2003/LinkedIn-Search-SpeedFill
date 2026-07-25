/**
 * LinkedIn SpeedFill – Auto-Fill & Manual "Save to SpeedFill" Engine v2.3.0
 *
 * Safe Filter Guarding:
 *  - STRICTLY SCOPED to Easy Apply modals (.jobs-easy-apply-modal)
 *  - COMPLETELY INACTIVE when user opens LinkedIn Search Filters ("Date Posted",
 *    "Experience Level", "All Filters", "Company", etc.)
 *  - NEVER clicks "Show results" or alters filter checkboxes/radios
 */

(function () {
  'use strict';

  const LOG = (...args) => console.log('[SpeedFill]', ...args);

  let userProfile      = null;
  let isObserverActive = false;

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

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.userProfile) {
        userProfile = changes.userProfile.newValue;
        LOG('Profile updated in real-time');
      }
    });
  }

  // ─── Filter Modal Guard ─────────────────────────────────────────────────────
  /**
   * Returns true if an element belongs to LinkedIn's search filter widgets
   */
  function isFilterElement(el) {
    if (!el) return false;
    if (el.closest('.search-reusables__all-filters-modal, .search-reusables__filter-binary-toggle, [class*="filter-panel"], [class*="filter-modal"], [data-test-search-filter]')) {
      return true;
    }
    const cls  = (el.className || '').toString().toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();
    return cls.includes('search-reusable') || aria.includes('filter');
  }

  /**
   * Strictly find the Easy Apply modal dialog. Returns null if user is on filter screens.
   */
  function findEasyApplyModal() {
    // Strategy 1: Specific Easy Apply modal container
    const modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content');
    if (modal && !isFilterElement(modal)) return modal;

    // Strategy 2: Check all dialogs, strictly excluding Filter modals
    const dialogs = document.querySelectorAll('div[role="dialog"], .artdeco-modal');
    for (const dialog of dialogs) {
      if (isFilterElement(dialog)) continue;

      const ariaLabel   = (dialog.getAttribute('aria-label') || '').toLowerCase();
      const heading     = dialog.querySelector('h1, h2, h3, h4, [class*="title"]');
      const headingText = (heading?.textContent || '').toLowerCase();

      if (ariaLabel.includes('easy apply') || ariaLabel.includes('apply to') ||
          headingText.includes('easy apply') || headingText.includes('apply to')) {
        return dialog;
      }
    }

    return null;
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

  // ─── Form Processor (Strictly scoped to modal) ─────────────────────────────

  function handleRadioGroups(modal) {
    if (!userProfile || !modal) return 0;

    let filledCount = 0;
    const containers = modal.querySelectorAll('fieldset, [role="radiogroup"], .fb-dash-form-element, [class*="form-element"]');

    containers.forEach(container => {
      const radioInputs = Array.from(container.querySelectorAll('input[type="radio"]'));
      if (radioInputs.length === 0) return;
      if (radioInputs.some(r => r.checked)) return;

      const headerEl = container.querySelector('legend, h1, h2, h3, h4, label, [class*="label"], span.t-14');
      const questionText = headerEl ? headerEl.textContent.toLowerCase().trim() : container.textContent.toLowerCase().trim();

      let targetValue = null;

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

  function handleResumeStep(modal) {
    if (!modal) return false;

    const resumeCards = Array.from(modal.querySelectorAll(
      '.jobs-resume-picker input[type="radio"]:not(:checked), ' +
      '[data-test-resume-card] input[type="radio"]:not(:checked), ' +
      'input[name="resume"]:not(:checked)'
    ));

    if (resumeCards.length > 0) {
      resumeCards[0].click();
      resumeCards[0].dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const useBtn = modal.querySelector('button[aria-label*="Use"], button[aria-label*="Select resume"]');
    if (useBtn) {
      useBtn.click();
      return true;
    }

    return false;
  }

  function handleCheckboxes(modal) {
    if (!modal) return;
    const checkboxes = modal.querySelectorAll('input[type="checkbox"]:not(:checked)');
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

  // ─── 💾 INJECT "SAVE TO SPEEDFILL" BUTTON (Inside Modal Only) ───────────────
  function injectSaveButton(container, inputEl = null) {
    if (!container || container.dataset.speedfillSaveInjected === 'true') return;
    container.dataset.speedfillSaveInjected = 'true';

    const targetInput = inputEl || container;

    const match = window.SpeedFillMatcher?.matchField(targetInput, userProfile);
    if (match !== null && match !== undefined && match.value) return;

    const btn = document.createElement('button');
    btn.className = 'speedfill-save-btn';
    btn.type = 'button';
    btn.innerHTML = '💾 Save to SpeedFill';

    function executeSave() {
      let questionText = window.SpeedFillMatcher?.getElementLabelText(targetInput);
      if (!questionText && container) {
        const headerEl = container.querySelector('legend, h1, h2, h3, h4, label, .fb-form-element-label, [class*="label"]');
        questionText = headerEl ? headerEl.textContent.trim() : '';
      }
      if (!questionText) questionText = 'Custom Question';

      let answerText = '';
      if (inputEl && inputEl.type === 'radio') {
        const selected = container.querySelector('input[type="radio"]:checked');
        answerText = selected ? (
          Array.from(selected.labels || [])[0]?.textContent ||
          selected.closest('label')?.textContent ||
          selected.nextElementSibling?.textContent ||
          selected.value || ''
        ).trim() : '';
      } else if (targetInput.tagName?.toLowerCase() === 'select') {
        const selOpt = targetInput.options[targetInput.selectedIndex];
        answerText = selOpt ? selOpt.text.trim() : targetInput.value.trim();
      } else {
        answerText = (targetInput.value || '').trim();
      }

      if (!answerText || answerText.toLowerCase() === 'select an option') {
        btn.innerHTML = '❌ Fill answer first';
        setTimeout(() => { btn.innerHTML = '💾 Save to SpeedFill'; }, 1600);
        return;
      }

      if (userProfile) {
        if (!Array.isArray(userProfile.screening)) userProfile.screening = [];

        const words = questionText.toLowerCase().replace(/[*:]/g, '').split(/\s+/).filter(w =>
          w.length > 2 && !['are', 'you', 'how', 'many', 'the', 'what', 'for', 'with', 'your', 'have', 'does', 'do', 'please'].includes(w)
        );
        const keywords = words.slice(0, 5).join(', ') || questionText.toLowerCase().substring(0, 30);

        const existing = userProfile.screening.find(item => item.keywords.toLowerCase() === keywords.toLowerCase());
        if (existing) {
          existing.answer = answerText;
        } else {
          userProfile.screening.push({ keywords, answer: answerText });
        }

        chrome.storage.local.set({ userProfile }, () => {
          btn.innerHTML = '✅ Saved!';
          btn.classList.add('saved');
          btn.disabled = true;
          LOG(`Saved Q&A: "${keywords}" → "${answerText}"`);
          showLearnToast(`🧠 Saved: "${keywords}" → "${answerText}"`);
        });
      }
    }

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      executeSave();
    });

    if (targetInput && targetInput.tagName?.toLowerCase() !== 'select' && targetInput.type !== 'radio') {
      targetInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          executeSave();
        }
      });
    }

    if (inputEl && inputEl.type === 'radio') {
      const header = container.querySelector('legend, h1, h2, h3, h4, .fb-form-element-label');
      if (header) {
        header.appendChild(btn);
      } else {
        container.appendChild(btn);
      }
    } else {
      const wrapper = container.closest('.jobs-easy-apply-form-element, .fb-dash-form-element, .artdeco-text-input--container') || container.parentElement || container;
      if (wrapper.nextSibling) {
        wrapper.parentNode.insertBefore(btn, wrapper.nextSibling);
      } else {
        wrapper.parentNode.appendChild(btn);
      }
    }
  }

  function attachSaveButtonsToUnmatchedFields(modal) {
    if (!modal) return;

    const inputs = modal.querySelectorAll(
      'input[type="text"], input[type="number"], input[type="email"], input[type="tel"], textarea, select'
    );
    inputs.forEach(input => {
      if (input.offsetWidth === 0 && input.offsetHeight === 0 || input.disabled || input.readOnly) return;
      injectSaveButton(input);
    });

    const radioContainers = modal.querySelectorAll('fieldset, [role="radiogroup"], .fb-dash-form-element');
    radioContainers.forEach(container => {
      const firstRadio = container.querySelector('input[type="radio"]');
      if (firstRadio) {
        injectSaveButton(container, firstRadio);
      }
    });
  }

  function showLearnToast(msg) {
    let toast = document.getElementById('sf-learn-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sf-learn-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    setTimeout(() => { if (toast) toast.style.opacity = '0'; }, 2600);
  }

  // ─── STEP NAVIGATOR: Click Next / Review / Submit (Modal-Scoped Only) ────────
  function clickContinueButton(modal) {
    if (!modal) return false;

    const buttons = Array.from(modal.querySelectorAll('button, input[type="button"], input[type="submit"], a[role="button"]'));

    const continueBtn = buttons.find(b => {
      if (b.disabled || b.getAttribute('aria-disabled') === 'true') return false;

      const ariaLabel = (b.getAttribute('aria-label') || '').toLowerCase().trim();
      const text      = (b.textContent || '').toLowerCase().trim();

      // STRICTLY EXCLUDE: Close/Dismiss buttons AND Filter "Show results" / "Apply" buttons
      if (ariaLabel === 'dismiss' || ariaLabel.includes('close modal') || text === 'dismiss' || text.includes('show') || text.includes('results')) return false;

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

  function clickSubmitButton(modal) {
    if (!modal) return false;

    const buttons = Array.from(modal.querySelectorAll('button, input[type="submit"]'));

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

  // ─── CORE FORM FILLING LOOP (Guarded & Modal Scoped) ───────────────────────
  function fillCurrentForm() {
    // 🛡️ STRICT GUARD: Is an Easy Apply modal open right now?
    const modal = findEasyApplyModal();
    if (!modal) {
      return 0; // COMPLETELY INACTIVE on LinkedIn filters & normal browsing
    }

    if (!userProfile) {
      loadProfile(() => fillCurrentForm());
      return 0;
    }

    let filledCount = 0;

    // 1. Handle Resume step inside modal
    const handledResume = handleResumeStep(modal);

    // 2. Handle Checkboxes inside modal
    handleCheckboxes(modal);

    // 3. Handle Radio groups inside modal
    filledCount += handleRadioGroups(modal);

    // 4. Handle Text inputs, textarea, numbers inside modal
    const inputs = modal.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), textarea'
    );
    inputs.forEach(input => {
      if (input.offsetWidth === 0 && input.offsetHeight === 0) return;
      const match = window.SpeedFillMatcher?.matchField(input, userProfile);
      if (match && match.value) {
        if (setReactInputValue(input, match.value)) filledCount++;
      }
    });

    // 5. Handle Select dropdowns inside modal
    const selects = modal.querySelectorAll('select');
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

    // 6. Inject "Save to SpeedFill" buttons for unmatched fields inside modal
    attachSaveButtonsToUnmatchedFields(modal);

    const stepDelay = userProfile?.settings?.stepDelayMs ?? 200;

    // 7. Check for Submit button inside modal first
    if (userProfile?.settings?.autoSubmitApplication !== false) {
      const submitted = clickSubmitButton(modal);
      if (submitted) return filledCount;
    }

    // 8. Auto-advance intermediate steps inside modal (Next / Continue / Review)
    if (userProfile?.settings?.autoAdvanceStep !== false) {
      setTimeout(() => clickContinueButton(modal), stepDelay);
    }

    return filledCount;
  }

  // ─── DOM OBSERVER & EVENT LISTENERS ─────────────────────────────────────────
  function setupDOMObserver() {
    if (isObserverActive) return;

    const observer = new MutationObserver(() => {
      clearTimeout(window._speedfillTimer);
      window._speedfillTimer = setTimeout(() => {
        // Guard check: only run if an Easy Apply modal is actually present
        const modal = findEasyApplyModal();
        if (modal && userProfile?.settings?.autoFillOnLoad !== false) {
          fillCurrentForm();
        }
      }, 50);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    isObserverActive = true;
  }

  // Click listener for Easy Apply button triggers
  document.addEventListener('click', e => {
    const target = e.target;
    if (!target) return;

    // Do NOT trigger if user clicked inside a LinkedIn Filter panel
    if (isFilterElement(target)) return;

    const isApplyBtn = target.textContent?.includes('Easy Apply') ||
                       target.getAttribute('aria-label')?.includes('Easy Apply') ||
                       target.closest('.jobs-apply-button');

    if (isApplyBtn) {
      LOG('User clicked Easy Apply button — initiating fast fill loop');
      [100, 300, 600, 1000, 1500].forEach(delay => {
        setTimeout(fillCurrentForm, delay);
      });
    }

    const modal = findEasyApplyModal();
    if (modal && target.matches('input[type="radio"], input[type="checkbox"], option')) {
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
        const modal = findEasyApplyModal();
        if (modal) {
          if (userProfile) {
            fillCurrentForm();
          } else {
            loadProfile(() => fillCurrentForm());
          }
        }
        sendResponse({ status: 'OK' });
        return true;
      }
    });
  }

  // ─── BOOT ──────────────────────────────────────────────────────────────────
  function init() {
    LOG('SpeedFill Engine v2.3.0 (Filter-Guarded Easy Apply Mode) initialized');
    loadProfile(() => {
      setupDOMObserver();
      // Only fill if an Easy Apply modal is already active
      const modal = findEasyApplyModal();
      if (modal) fillCurrentForm();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
