/**
 * Browser-side DOM walk, kept as a string so tsx/esbuild cannot inject `__name`
 * (that helper does not exist inside Playwright's page.evaluate context).
 */
export function collectUiDomScript(testIdAttributes: string[] = ['data-testid', 'data-test']): string {
  return `(() => {
  const TEST_ID_ATTRS = ${JSON.stringify(testIdAttributes)};

  const isVisible = function (el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const associatedLabel = function (el) {
    if (el.id) {
      try {
        const escaped = window.CSS && CSS.escape ? CSS.escape(el.id) : el.id;
        const byFor = document.querySelector('label[for="' + escaped + '"]');
        if (byFor) return (byFor.textContent || '').trim().slice(0, 120);
      } catch (err) { /* invalid id for a CSS selector */ }
    }
    const parent = el.closest && el.closest('label');
    if (parent) return (parent.textContent || '').trim().slice(0, 120);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy.split(/\\s+/).map(function (id) {
        const node = document.getElementById(id);
        return node ? (node.textContent || '').trim() : '';
      }).filter(Boolean);
      if (parts.length) return parts.join(' ').slice(0, 120);
    }
    return null;
  };

  const isEditable = function (el) {
    if (el.isContentEditable) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return !el.disabled && !el.readOnly;
    if (tag !== 'input') return false;
    const type = (el.type || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset', 'file', 'checkbox', 'radio'].indexOf(type) !== -1) return false;
    return !el.disabled && !el.readOnly;
  };

  const firstTestId = function (el) {
    for (var i = 0; i < TEST_ID_ATTRS.length; i++) {
      const value = el.getAttribute(TEST_ID_ATTRS[i]);
      if (value) return { attr: TEST_ID_ATTRS[i], value: value };
    }
    return null;
  };

  const relevantAttributes = function (el) {
    const attrs = {};
    const keys = ['id', 'name', 'type', 'role', 'href', 'placeholder', 'autocomplete', 'aria-label', 'aria-expanded', 'aria-required'];
    TEST_ID_ATTRS.forEach(function (key) { keys.push(key); });
    keys.forEach(function (key) {
      const value = el.getAttribute(key);
      if (value) attrs[key] = value;
    });
    return attrs;
  };

  const snapshot = function (el, category, evidence, candidate) {
    const input = el;
    const nameAttr = el.getAttribute('name');
    const nameProp = typeof input.name === 'string' ? input.name : '';
    const testId = firstTestId(el);
    return {
      category: category,
      tag: el.tagName.toLowerCase(),
      inputType: typeof input.type === 'string' ? input.type : null,
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 120),
      controlValue: (typeof input.type === 'string' && input.type.toLowerCase() === 'password')
        ? null
        : (typeof input.value === 'string' && (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'button')
          ? String(input.value).trim().slice(0, 80)
          : null),
      ariaLabel: el.getAttribute('aria-label'),
      label: associatedLabel(el),
      placeholder: typeof input.placeholder === 'string' ? input.placeholder : null,
      name: nameProp || nameAttr,
      id: el.id || null,
      testId: testId ? testId.value : null,
      testIdAttribute: testId ? testId.attr : null,
      visible: isVisible(el),
      enabled: !('disabled' in input) || !input.disabled,
      required: Boolean(input.required) || el.getAttribute('aria-required') === 'true',
      editable: isEditable(el),
      readOnly: Boolean(input.readOnly),
      min: input.min || el.getAttribute('min'),
      max: input.max || el.getAttribute('max'),
      minLength: input.minLength > 0 ? String(input.minLength) : el.getAttribute('minlength'),
      maxLength: input.maxLength > 0 ? String(input.maxLength) : el.getAttribute('maxlength'),
      formMethod: (el.closest && el.closest('form') && el.closest('form').getAttribute('method')) || null,
      href: el.getAttribute('href'),
      isSubmit: input.type === 'submit' || el.getAttribute('type') === 'submit',
      attributes: relevantAttributes(el),
      evidence: evidence,
      candidate: Boolean(candidate),
    };
  };

  const seen = new Set();
  const out = [];

  const collect = function (selector, category, evidence, candidate) {
    document.querySelectorAll(selector).forEach(function (el) {
      if (seen.has(el)) return;
      seen.add(el);
      out.push(snapshot(el, category, evidence, candidate));
    });
  };

  collect('header, [role="banner"]', 'header', 'semantic header / role=banner');
  collect('footer, [role="contentinfo"]', 'footer', 'semantic footer / role=contentinfo');
  collect('aside, [role="complementary"]', 'sidebar', 'aside / role=complementary');
  collect(
    'nav[aria-label*="breadcrumb" i], [aria-label*="breadcrumb" i], ol.breadcrumb, .breadcrumb',
    'breadcrumbs',
    'breadcrumb landmark or class'
  );
  collect('nav, [role="navigation"], [role="menubar"]', 'navigation', 'nav / role=navigation|menubar');
  collect('a[href]', 'link', '<a href>');
  collect('button, [role="button"], input[type="submit"], input[type="button"]', 'button', 'button / role=button');
  collect('textarea', 'textarea', '<textarea>');
  collect(
    'select[data-test*="sort" i], select[data-testid*="sort" i], select[id*="sort" i], select[name*="sort" i], select[class*="sort" i]',
    'sort',
    'select whose id/name/class/test id matched sort'
  );
  collect('select', 'select', '<select>');
  collect('input[type="checkbox"]', 'checkbox', 'input type=checkbox');
  collect('input[type="radio"]', 'radio', 'input type=radio');
  collect('[role="switch"], input[type="checkbox"][role="switch"]', 'toggle', 'role=switch');
  collect('input[type="file"]', 'file-upload', 'input type=file');
  collect('input[type="search"], [role="search"] input, form[role="search"] input', 'search', 'search input or role=search');
  collect(
    'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="number"], input[type="tel"], input[type="url"], input[type="date"], input[type="datetime-local"], input[type="time"]',
    'input',
    'text-like input'
  );
  collect('form', 'form', '<form>');
  collect('table, [role="table"], [role="grid"]', 'table', 'table / role=table|grid');
  collect(
    'nav[aria-label*="pagination" i], [aria-label*="pagination" i], a[rel="next"], a[rel="prev"]',
    'pagination',
    'pagination landmark or rel=next|prev'
  );
  collect('[role="tab"], [role="tablist"]', 'tab', 'role=tab or tablist');
  collect('details, [aria-expanded]', 'accordion', 'details or aria-expanded disclosure');
  collect('dialog, [role="dialog"], [aria-modal="true"]', 'modal', 'dialog / role=dialog / aria-modal');
  collect('[role="menu"], [role="listbox"], [popover]', 'popup', 'menu, listbox, or popover');
  collect('[role="tooltip"]', 'tooltip', 'role=tooltip');
  collect('img', 'image', '<img>');
  collect('video, iframe[src*="youtube"], iframe[src*="vimeo"]', 'video', 'video element or known embed');

  const filterLike = /filter|refine/i;
  const sortLike = /sort|order by|newest|oldest/i;
  document.querySelectorAll('button, select, a, [role="button"]').forEach(function (el) {
    if (seen.has(el)) return;
    const label = ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim();
    if (filterLike.test(label)) {
      seen.add(el);
      out.push(snapshot(el, 'filter', 'accessible name matched /filter|refine/: "' + label.slice(0, 80) + '"', true));
    } else if (sortLike.test(label)) {
      seen.add(el);
      out.push(snapshot(el, 'sort', 'accessible name matched /sort|order by/: "' + label.slice(0, 80) + '"', true));
    }
  });

  document.querySelectorAll('[title]').forEach(function (el) {
    if (seen.has(el)) return;
    const title = el.getAttribute('title');
    if (!title || !title.trim()) return;
    seen.add(el);
    out.push(snapshot(el, 'tooltip', 'title attribute (weak tooltip evidence)', true));
  });

  return out;
})()`;
}

export const COLLECT_UI_DOM = collectUiDomScript();
