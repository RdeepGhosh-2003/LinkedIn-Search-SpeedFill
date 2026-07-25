/**
 * LinkedIn SpeedFill - Easy Apply Modal Auto-Fill & Step Navigator Engine
 * Handles field filling, radio choices, dropdown comboboxes, resume selection,
 * step auto-advancement, and safe submission.
 */

(function() {
  'use strict';

  let profile = null;
  let isRunning = false;
  let observer = null;
  let stepTimer = null;

  // Load profile from storage
  function loadProfile(callback) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['userProfile'], (result) => {
        if (result.userProfile) {
          profile = result.userProfile;
        } else {
          // Default fallback profile structure
          profile = {
            personal: { fullName: "John Doe", email: "john.doe@example.com", phone: "1234567890", city: "Sample City" },
            work: { currentRole: { jobTitle: "Software Engineer", company: "Acme", yearsExperience: "3" }, targetRole: { expectedSalary: "700000", noticePeriod: "30 Days" } },
            education: { degree: "Bachelor of Science", major: "Computer Science", university: "Sample University" },
            screening: [],
            settings: { autoFillOnLoad: true, pauseOnUnmatchedFields: true, stepDelayMs: 500, autoSelectResume: true, autoAdvanceStep: true, autoSubmitApplication: true, highlightFilledFields: true }
          };
        }
        if (callback) callback();
      });
    }
  }

  // Trigger synthetic native events so React state updates
  function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // Handle radio fieldsets (e.g. Yes/No questions, experience questions)
  function processRadioGroups(modal) {
    const fieldsets = modal.querySelectorAll('fieldset');
    let hasUnfilledRequired = false;

    fieldsets.forEach(fieldset => {
      const radios = Array.from(fieldset.querySelectorAll('input[type="radio"]'));
      if (radios.length === 0) return;

      // Check if any radio in this group is already selected
      const isAnyChecked = radios.some(r => r.checked);
      if (isAnyChecked) return;

      const legendText = (fieldset.querySelector('legend')?.textContent || fieldset.textContent || '').toLowerCase();
      let matchedChoice = null;

      // Match against screening bank or profile
      if (profile.screening && Array.isArray(profile.screening)) {
        for (const item of profile.screening) {
          const keywords = item.keywords.toLowerCase().split(',').map(k => k.trim());
          for (const kw of keywords) {
            if (kw && legendText.includes(kw)) {
              matchedChoice = item.answer.toLowerCase();
              break;
            }
          }
          if (matchedChoice) break;
        }
      }

      // Fallback matching for common questions (work authorization, sponsorship, relocation)
      if (!matchedChoice) {
        if (legendText.includes('authorized') || legendText.includes('legally') || legendText.includes('permit')) {
          matchedChoice = 'yes';
        } else if (legendText.includes('sponsor') || legendText.includes('visa')) {
          matchedChoice = 'no'; // Default to no sponsorship required unless specified
        } else if (legendText.includes('relocate') || legendText.includes('relocation')) {
          matchedChoice = 'yes';
        } else if (legendText.includes('experience') || legendText.includes('years')) {
          matchedChoice = 'yes';
        }
      }

      // Pick radio option matching matchedChoice, or fallback to 'Yes'
      if (matchedChoice) {
        const targetRadio = radios.find(r => {
          const label = (r.labels?.[0]?.textContent || r.nextElementSibling?.textContent || r.value || '').toLowerCase();
          return label.includes(matchedChoice) || (matchedChoice === 'yes' && label.includes('yes'));
        }) || radios[0];

        if (targetRadio) {
          targetRadio.click();
          targetRadio.checked = true;
          targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
          fieldset.classList.add('speedfill-highlight');
        }
      } else {
        // Highlighting unanswered required radio group
        fieldset.classList.add('speedfill-warning');
        hasUnfilledRequired = true;
      }
    });

    return hasUnfilledRequired;
  }

  // Handle select dropdowns and LinkedIn comboboxes
  function processDropdowns(modal) {
    const selects = modal.querySelectorAll('select');
    selects.forEach(select => {
      if (select.value && select.value !== 'Select an option' && select.value !== '') return;

      const match = window.SpeedFillMatcher ? window.SpeedFillMatcher.matchField(select, profile) : null;
      if (match && match.value) {
        const options = Array.from(select.options);
        const targetOpt = options.find(o => o.text.toLowerCase().includes(match.value.toString().toLowerCase())) || options[1];

        if (targetOpt) {
          select.value = targetOpt.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          select.classList.add('speedfill-highlight');
        }
      }
    });
  }

  // Handle text inputs and numeric input fields
  function processInputs(modal) {
    let hasUnfilledRequired = false;
    const inputs = modal.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea');

    inputs.forEach(input => {
      if (input.dataset.speedfillUserEdited === 'true') return;
      if (input.value && input.value.trim() !== '') return;

      const match = window.SpeedFillMatcher ? window.SpeedFillMatcher.matchField(input, profile) : null;

      if (match && match.value !== null && match.value !== undefined) {
        setNativeValue(input, match.value);
        if (profile.settings && profile.settings.highlightFilledFields) {
          input.classList.add('speedfill-highlight');
        }
      } else {
        // Check if field is required
        const isRequired = input.required || input.getAttribute('aria-required') === 'true' || input.id?.includes('required');
        if (isRequired) {
          input.classList.add('speedfill-warning');
          hasUnfilledRequired = true;
        }
      }
    });

    return hasUnfilledRequired;
  }

  // Handle automatic resume selection step
  function processResumeSelection(modal) {
    if (!profile.settings || !profile.settings.autoSelectResume) return;

    const resumePicker = modal.querySelector('.jobs-resume-picker, .jobs-document-upload-redesign');
    if (resumePicker) {
      const firstResumeCard = resumePicker.querySelector('input[type="radio"], button[aria-label*="resume"], div[data-test-document-card]');
      if (firstResumeCard) {
        if (firstResumeCard.tagName === 'INPUT' && !firstResumeCard.checked) {
          firstResumeCard.click();
          firstResumeCard.checked = true;
          firstResumeCard.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (firstResumeCard.tagName === 'BUTTON') {
          firstResumeCard.click();
        }
      }
    }
  }

  // Main step processing function
  function processModalStep() {
    const modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, [role="dialog"]');
    if (!modal) return;

    // Process inputs, radios, dropdowns, and resumes
    const missingInputs = processInputs(modal);
    const missingRadios = processRadioGroups(modal);
    processDropdowns(modal);
    processResumeSelection(modal);

    const hasMissingData = missingInputs || missingRadios;

    if (hasMissingData && profile.settings && profile.settings.pauseOnUnmatchedFields) {
      window.postMessage({ type: 'SPEEDFILL_REVIEW_NEEDED' }, '*');
      return;
    }

    // Auto Advance Step if enabled
    if (profile.settings && profile.settings.autoAdvanceStep) {
      const delay = profile.settings.stepDelayMs || 500;
      clearTimeout(stepTimer);

      stepTimer = setTimeout(() => {
        advanceNextStep(modal);
      }, delay);
    }
  }

  // Advance step button click handler
  function advanceNextStep(modal) {
    // Check for footer buttons: Next, Review, Submit
    const nextBtn = modal.querySelector('button[aria-label*="Continue"], button[aria-label*="Next"], button[data-easy-apply-next-button]');
    const reviewBtn = modal.querySelector('button[aria-label*="Review"], button[data-easy-apply-review-button]');
    const submitBtn = modal.querySelector('button[aria-label*="Submit application"], button[data-easy-apply-submit-button]');
    const dismissBtn = modal.querySelector('button[aria-label*="Dismiss"], button[data-test-modal-close-btn]');

    if (submitBtn && profile.settings && profile.settings.autoSubmitApplication) {
      submitBtn.click();
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
      
      // Auto close confirmation dialog after submission
      setTimeout(() => {
        const closeBtn = document.querySelector('button[aria-label*="Dismiss"], button.artdeco-modal__dismiss');
        if (closeBtn) closeBtn.click();
      }, 1000);
      return;
    }

    if (reviewBtn) {
      reviewBtn.click();
      return;
    }

    if (nextBtn) {
      nextBtn.click();
      return;
    }

    // Check if post-submit "Done" screen is displayed
    const doneBtn = modal.querySelector('button[aria-label*="Dismiss"], button[data-test-modal-close-btn]');
    if (doneBtn) {
      doneBtn.click();
      window.postMessage({ type: 'SPEEDFILL_APPLICATION_SUBMITTED' }, '*');
    }
  }

  // Observe DOM for modal appearance
  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver((mutations) => {
      const modal = document.querySelector('.jobs-easy-apply-modal, .jobs-easy-apply-content, [role="dialog"]');
      if (modal) {
        processModalStep();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Keyboard shortcut listener for Alt+F trigger
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'TRIGGER_AUTOFILL') {
        loadProfile(() => {
          processModalStep();
          sendResponse({ status: 'SUCCESS' });
        });
        return true;
      }
    });
  }

  // Init listener
  function init() {
    loadProfile(() => {
      startObserver();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
