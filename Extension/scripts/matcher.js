/**
 * LinkedIn SpeedFill - Matcher Module
 * Sub-10ms Fuzzy Label & Field Identifier Engine
 */

window.SpeedFillMatcher = (function() {
  
  // Field dictionary mapping label keywords to profile paths
  const FIELD_MAPPINGS = [
    // Current Role
    { keys: ['current job title', 'current role', 'present position', 'recent job title', 'job title', 'title', 'role', 'designation', 'position'], path: 'work.currentRole.jobTitle' },
    { keys: ['current company', 'present company', 'company name', 'company', 'employer', 'organization'], path: 'work.currentRole.company' },
    { keys: ['years of experience', 'years experience', 'total experience', 'overall experience', 'how many years of experience'], path: 'work.currentRole.yearsExperience' },
    { keys: ['current ctc', 'current salary', 'present salary'], path: 'work.currentRole.currentSalary' },

    // Target Role
    { keys: ['target job title', 'desired role', 'target role', 'desired position', 'role applying for'], path: 'work.targetRole.jobTitle' },
    { keys: ['expected ctc', 'expected salary', 'desired salary', 'salary expectation', 'compensation requirement'], path: 'work.targetRole.expectedSalary' },
    { keys: ['notice period', 'notice', 'how soon can you start', 'availability', 'earliest start date'], path: 'work.targetRole.noticePeriod' },
    { keys: ['target location', 'preferred location', 'desired city'], path: 'work.targetRole.targetLocation' },

    // Personal Details
    { keys: ['first name', 'given name'], path: 'personal.firstName' },
    { keys: ['last name', 'surname', 'family name'], path: 'personal.lastName' },
    { keys: ['full name', 'name'], path: 'personal.fullName' },
    { keys: ['email', 'email address'], path: 'personal.email' },
    { keys: ['phone', 'mobile', 'contact number', 'phone number'], path: 'personal.phone' },
    { keys: ['city', 'location', 'current city'], path: 'personal.city' },
    { keys: ['state', 'province'], path: 'personal.state' },
    { keys: ['country'], path: 'personal.country' },
    { keys: ['linkedin', 'linkedin profile', 'linkedin url'], path: 'personal.linkedin' },
    { keys: ['github', 'portfolio', 'website'], path: 'personal.github' },

    // Education
    { keys: ['degree', 'highest degree', 'qualification', 'education level'], path: 'education.degree' },
    { keys: ['field of study', 'major', 'stream', 'specialization'], path: 'education.major' },
    { keys: ['university', 'college', 'school', 'institution'], path: 'education.university' },
    { keys: ['graduation year', 'year of completion', 'passing year'], path: 'education.graduationYear' }
  ];

  /**
   * Check if element is a global search bar on LinkedIn header (e.g. global search input)
   */
  function isSearchInput(el) {
    if (!el) return false;

    // If inside Easy Apply modal or any dialog, it's NOT main header search
    if (el.closest('.jobs-easy-apply-modal, .jobs-easy-apply-content, [role="dialog"], [data-test-modal]')) {
      return false;
    }

    const role = el.getAttribute('role') || '';
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const classList = (el.className || '').toString().toLowerCase();

    if (ariaLabel.includes('search') || classList.includes('search-global') || role === 'combobox') {
      if (!el.closest('.jobs-easy-apply-modal, [role="dialog"]')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Helper to safely extract nested value from object path
   */
  function getNestedValue(obj, path) {
    if (!obj || !path) return null;
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current[key] === undefined || current[key] === null) return null;
      current = current[key];
    }
    return current;
  }

  /**
   * Find label text associated with a given input/select/fieldset element on LinkedIn
   */
  function getElementLabelText(el) {
    let labelTexts = [];

    // 1. Explicit <label for="id">
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) labelTexts.push(labelEl.textContent);
    }

    // 2. Parent <label> or wrapper label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      labelTexts.push(parentLabel.textContent);
    }

    // 3. Fieldset legend (very common in LinkedIn Easy Apply question groups)
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) labelTexts.push(legend.textContent);
    }

    // 4. Container question label (.jobs-easy-apply-form-element, .fb-dash-form-element, etc.)
    const container = el.closest('.jobs-easy-apply-form-element, .fb-dash-form-element, .fb-form-element, div[data-test-form-element]');
    if (container) {
      const header = container.querySelector('label, legend, span.fb-form-element-label, span.t-14, .jobs-easy-apply-form-element__label');
      if (header) labelTexts.push(header.textContent);
    }

    // 5. Direct attributes: aria-label, aria-labelledby, placeholder, name, id
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const target = document.getElementById(ariaLabelledBy);
      if (target) labelTexts.push(target.textContent);
    }

    if (el.getAttribute('aria-label')) labelTexts.push(el.getAttribute('aria-label'));
    if (el.placeholder) labelTexts.push(el.placeholder);
    if (el.name) labelTexts.push(el.name);
    if (el.id) labelTexts.push(el.id);

    return labelTexts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Match an input/select element to user profile value or Q&A bank
   */
  function matchField(el, profile) {
    if (!profile) return null;
    if (isSearchInput(el)) return null;

    const labelText = getElementLabelText(el);
    if (!labelText) return null;

    // Check direct dictionary mappings
    for (const mapping of FIELD_MAPPINGS) {
      for (const key of mapping.keys) {
        if (labelText.includes(key)) {
          const val = getNestedValue(profile, mapping.path);
          if (val !== null && val !== undefined) return { value: val, confidence: 0.95, keyMatched: key };
        }
      }
    }

    // Check screening Q&A bank
    if (profile.screening && Array.isArray(profile.screening)) {
      for (const item of profile.screening) {
        const keywords = item.keywords.toLowerCase().split(',').map(k => k.trim());
        for (const kw of keywords) {
          if (kw && labelText.includes(kw)) {
            return { value: item.answer, confidence: 0.85, keyMatched: kw };
          }
        }
      }
    }

    return null;
  }

  return {
    matchField,
    getElementLabelText,
    isSearchInput
  };
})();
