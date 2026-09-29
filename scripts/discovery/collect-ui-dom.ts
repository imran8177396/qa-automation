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
    const keys = [
      'id', 'name', 'type', 'role', 'href', 'placeholder', 'autocomplete', 'inputmode', 'value',
      'pattern', 'min', 'max', 'minlength', 'maxlength',
      'aria-label', 'aria-expanded', 'aria-required', 'aria-busy', 'aria-invalid', 'aria-modal',
      'aria-hidden', 'aria-autocomplete', 'aria-haspopup', 'aria-pressed', 'aria-roledescription',
      'kind', 'multiple', 'popover',
    ];
    TEST_ID_ATTRS.forEach(function (key) { keys.push(key); });
    keys.forEach(function (key) {
      if (!el.hasAttribute(key)) return;
      const value = el.getAttribute(key);
      attrs[key] = value == null ? '' : value;
    });
    return attrs;
  };

  const overlayRoot = function (el) {
    return el.closest && el.closest('dialog, [role="dialog"], [aria-modal="true"]');
  };

  const accessibleNameHint = function (el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim().slice(0, 120);
    const labelled = associatedLabel(el);
    if (labelled) return labelled;
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return alt.trim().slice(0, 120);
    return (el.textContent || '').trim().slice(0, 120);
  };

  const snapshot = function (el, category, evidence, candidate) {
    const input = el;
    const nameAttr = el.getAttribute('name');
    const nameProp = typeof input.name === 'string' ? input.name : '';
    const testId = firstTestId(el);
    const inFigure = Boolean(el.closest && el.closest('figure'));
    const roleAttr = (el.getAttribute('role') || '').toLowerCase();
    const tagName = el.tagName.toLowerCase();
    const nameHint = accessibleNameHint(el);
    const chartCandidate = Boolean(
      inFigure &&
      nameHint &&
      (roleAttr === 'img' || tagName === 'img')
    );
    return {
      category: category,
      tag: tagName,
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
      optionValues: (function () {
        if (tagName !== 'select') return undefined;
        const values = [];
        const opts = el.options || el.querySelectorAll('option');
        for (var i = 0; i < opts.length; i++) {
          const opt = opts[i];
          const v = (opt.value != null && String(opt.value).length > 0)
            ? String(opt.value)
            : String(opt.textContent || '').trim();
          if (v) values.push(v.slice(0, 80));
        }
        return values.length ? values.slice(0, 50) : [];
      })(),
      evidence: evidence,
      candidate: Boolean(candidate),
      insideOverlay: Boolean(overlayRoot(el)),
      chartCandidate: chartCandidate,
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
  collect('[role="progressbar"], [aria-busy="true"]', 'interactive', 'progressbar or aria-busy loading evidence');
  collect('[role="alert"]', 'alert', 'role=alert');
  collect(
    '[role="status"][aria-label*="notif" i], [role="status"][kind="notification"]',
    'notification',
    'role=status notification evidence'
  );
  collect(
    '[role="status"][aria-label*="badge" i], [kind="badge"], [role="status"][kind="badge"]',
    'badge',
    'badge evidence (aria-label/kind)'
  );
  collect(
    '[role="status"][aria-label*="empty" i], [kind="empty-state"], [role="status"][kind="empty"]',
    'empty-state',
    'empty-state evidence'
  );
  collect(
    '[role="status"][aria-label*="error" i], [kind="error-state"], [role="alert"][kind="error"]',
    'error-state',
    'error-state evidence'
  );
  collect('[role="status"], [role="alert"]', 'interactive', 'role=status|alert (scanner text / kind only)');
  collect('img', 'image', '<img>');
  collect('video, iframe[src*="youtube"], iframe[src*="vimeo"]', 'video', 'video element or known embed');

  collect('ul, ol, [role="list"]', 'list', 'ul/ol / role=list');
  collect('article, [role="article"]', 'card', 'article / role=article');
  collect(
    '[aria-roledescription*="carousel" i], [role="region"][aria-roledescription*="carousel" i]',
    'carousel',
    'aria-roledescription carousel'
  );
  collect('input[type="range"], [role="slider"]', 'slider', 'input type=range / role=slider');
  collect(
    'figure [role="img"], figure img[alt]:not([alt=""])',
    'chart',
    'named role=img or img[alt] inside figure (chart candidate)'
  );
  collect('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]', 'menu', 'role=menuitem*');
  collect('[role="menu"]', 'menu', 'role=menu');
  collect(
    '[aria-label*="drawer" i][role="dialog"], [kind="drawer"], dialog[kind="drawer"]',
    'drawer',
    'drawer dialog evidence (aria-label/kind)'
  );
  collect('input[type="reset"], button[type="reset"]', 'button', 'reset control');

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
