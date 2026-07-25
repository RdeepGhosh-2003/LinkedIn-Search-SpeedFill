/**
 * LinkedIn SpeedFill - Matcher Module v1.2.1
 * Sub-10ms Fuzzy Label & Field Identifier Engine
 * Tailored to LinkedIn's Easy Apply modal DOM structure (2026 DOM verified)
 */

window.SpeedFillMatcher = (function () {
  'use strict';

  // ─── Field Dictionary ───────────────────────────────────────────────────────
  const FIELD_MAPPINGS = [
    // ── Current Role ──────────────────────────────────────────────────────────
    {
      keys: ['current job title', 'current role', 'present position', 'job title',
             'title', 'role', 'designation', 'position', 'your title'],
      path: 'work.currentRole.jobTitle'
    },
    {
      keys: ['current company', 'present company', 'company name', 'company',
             'employer', 'organization', 'employer name'],
      path: 'work.currentRole.company'
    },
    {
      keys: ['years of experience', 'years experience', 'total experience',
             'how many years', 'overall experience', 'work experience (years)',
             'professional experience'],
      path: 'work.currentRole.yearsExperience'
    },
    {
      keys: ['current ctc', 'current salary', 'present salary', 'current compensation'],
      path: 'work.currentRole.currentSalary'
    },

    // ── Target Role ───────────────────────────────────────────────────────────
    {
      keys: ['target job title', 'desired role', 'desired position', 'applying for'],
      path: 'work.targetRole.jobTitle'
    },
    {
      keys: ['expected ctc', 'expected salary', 'desired salary',
             'salary expectation', 'compensation expectation', 'salary expected',
             'what are your salary expectations'],
      path: 'work.targetRole.expectedSalary'
    },
    {
      keys: ['notice period', 'notice', 'how soon can you start',
             'availability', 'earliest start', 'when can you start'],
      path: 'work.targetRole.noticePeriod'
    },
    {
      keys: ['target location', 'preferred location', 'desired city', 'preferred city'],
      path: 'work.targetRole.targetLocation'
    },

    // ── Personal ──────────────────────────────────────────────────────────────
    { keys: ['first name', 'given name', 'firstname'],           path: 'personal.firstName' },
    { keys: ['last name', 'surname', 'family name', 'lastname'], path: 'personal.lastName' },
    { keys: ['full name', 'your name'],                          path: 'personal.fullName' },
    { keys: ['email address', 'email', 'e-mail'],                path: 'personal.email' },
    {
      keys: ['mobile phone number', 'mobile phone', 'phone number', 'contact number', 'phone', 'mobile', 'cell'],
      path: 'personal.phone'
    },
    { keys: ['city', 'current city', 'location city'],       path: 'personal.city' },
    { keys: ['state', 'province', 'state/province'],          path: 'personal.state' },
    { keys: ['country', 'country of residence', 'phone country code', 'country code'], path: 'personal.country' },
    {
      keys: ['linkedin', 'linkedin profile', 'linkedin url', 'linkedin profile url'],
      path: 'personal.linkedin'
    },
    { keys: ['github', 'portfolio', 'website', 'portfolio url'], path: 'personal.github' },

    // ── Education ─────────────────────────────────────────────────────────────
    {
      keys: ['degree', 'highest degree', 'qualification', 'education level', 'highest qualification'],
      path: 'education.degree'
    },
    {
      keys: ['field of study', 'major', 'stream', 'specialization', 'discipline'],
      path: 'education.major'
    },
    {
      keys: ['university', 'college', 'school', 'institution', 'institute', 'alma mater'],
      path: 'education.university'
    },
    {
      keys: ['graduation year', 'year of completion', 'passing year', 'year of graduation', 'end year'],
      path: 'education.graduationYear'
    }
  ];

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function getNestedValue(obj, path) {
    if (!obj || !path) return null;
    return path.split('.').reduce((cur, key) => (cur != null ? cur[key] : null), obj);
  }

  function isGlobalSearchInput(el) {
    if (!el) return false;
    if (el.closest('.jobs-easy-apply-modal, .jobs-easy-apply-content, [data-test-modal], [role="dialog"]')) {
      return false;
    }
    const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
    const cls = (el.className || '').toString().toLowerCase();
    return ariaLabel.includes('search') || cls.includes('search-global') || cls.includes('global-search');
  }

  function getElementLabelText(el) {
    const parts = [];

    // 1. Explicit <label for="id">
    if (el.id) {
      try {
        const root = el.getRootNode ? el.getRootNode() : document;
        const lbl = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lbl) parts.push(lbl.textContent);
      } catch(e) {}
    }

    // 2. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) parts.push(parentLabel.textContent);

    // 3. Fieldset <legend>
    const fieldset = el.closest('fieldset');
    if (fieldset) {
      const legend = fieldset.querySelector('legend');
      if (legend) parts.push(legend.textContent);
    }

    // 4. LinkedIn Easy Apply form element containers
    const containers = [
      '.jobs-easy-apply-form-element',
      '.fb-dash-form-element',
      '.fb-form-element',
      '[data-test-form-element]',
      '.artdeco-text-input--container',
      '[class*="form-element"]',
      '[class*="FormElement"]',
      '[class*="form-component"]'
    ];
    const container = el.closest(containers.join(', '));
    if (container) {
      const header = container.querySelector(
        'label, legend, .fb-form-element-label, .artdeco-text-input--label, ' +
        '.jobs-easy-apply-form-element__label, span.t-14, [class*="label"]'
      );
      if (header) parts.push(header.textContent);
    }

    // 5. Walk up host elements if inside shadow root
    let node = el;
    for (let i = 0; i < 6; i++) {
      if (!node.parentElement && node.parentNode instanceof ShadowRoot) {
        const host = node.parentNode.host;
        const hostLabel = host.getAttribute('label') ||
                          host.getAttribute('data-label') ||
                          host.getAttribute('data-field-name') ||
                          host.getAttribute('name') ||
                          host.getAttribute('componentkey') ||
                          host.getAttribute('data-component-type') || '';
        if (hostLabel) parts.push(hostLabel);
        node = host;
      } else {
        break;
      }
    }

    // 6. aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const root = el.getRootNode ? el.getRootNode() : document;
      labelledBy.split(' ').forEach(id => {
        try {
          const target = root.getElementById(id);
          if (target) parts.push(target.textContent);
        } catch(e) {}
      });
    }

    // 7. Direct attributes
    const attrs = [
      'aria-label',
      'placeholder',
      'name',
      'id',
      'data-test-text-entity-list-form-input',
      'data-test-single-typeahead-entity-form-input',
      'data-test-text-entity-list-form-select'
    ];
    attrs.forEach(attr => {
      const val = el.getAttribute(attr);
      if (val) parts.push(val);
    });

    return parts.join(' ').toLowerCase().replace(/[*:]/g, '').replace(/\s+/g, ' ').trim();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  function matchField(el, profile) {
    if (!profile) return null;
    if (isGlobalSearchInput(el)) return null;

    const labelText = getElementLabelText(el);
    if (!labelText) return null;

    // 1. Dictionary mappings
    for (const mapping of FIELD_MAPPINGS) {
      for (const key of mapping.keys) {
        if (labelText.includes(key)) {
          const val = getNestedValue(profile, mapping.path);
          if (val !== null && val !== undefined && val !== '') {
            return { value: String(val), confidence: 0.95, keyMatched: key };
          }
        }
      }
    }

    // 2. Q&A screening bank
    if (Array.isArray(profile.screening)) {
      for (const item of profile.screening) {
        if (!item.keywords) continue;
        const keywords = item.keywords.toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
        for (const kw of keywords) {
          if (labelText.includes(kw)) {
            return { value: item.answer, confidence: 0.85, keyMatched: kw };
          }
        }
      }
    }

    return null;
  }

  return { matchField, getElementLabelText, isGlobalSearchInput };
})();
