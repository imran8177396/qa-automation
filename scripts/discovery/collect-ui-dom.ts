/**
 * Browser-side DOM walk, kept as a string so tsx/esbuild cannot inject `__name`
 * (that helper does not exist inside Playwright's page.evaluate context).
 */
export const COLLECT_UI_DOM = `(() => {
  const isVisible = function (el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };

  const snapshot = function (el, category, evidence, candidate) {
    const input = el;
    // HTMLFormElement.name is the control named "name", not a string — never invent a locator from that.
    const nameAttr = el.getAttribute('name');
    const nameProp = typeof input.name === 'string' ? input.name : '';
    return {
      category: category,
      tag: el.tagName.toLowerCase(),
      inputType: typeof input.type === 'string' ? input.type : null,
      role: el.getAttribute('role'),
      text: (el.textContent || '').trim().slice(0, 120),
      ariaLabel: el.getAttribute('aria-label'),
      placeholder: typeof input.placeholder === 'string' ? input.placeholder : null,
      name: nameProp || nameAttr,
      id: el.id || null,
      testId: el.getAttribute('data-testid'),
      visible: isVisible(el),
      enabled: !('disabled' in input) || !input.disabled,
      required: Boolean(input.required),
      readOnly: Boolean(input.readOnly),
      min: input.min || el.getAttribute('min'),
      max: input.max || el.getAttribute('max'),
      minLength: input.minLength > 0 ? String(input.minLength) : el.getAttribute('minlength'),
      maxLength: input.maxLength > 0 ? String(input.maxLength) : el.getAttribute('maxlength'),
      formMethod: (el.closest && el.closest('form') && el.closest('form').getAttribute('method')) || null,
      href: el.getAttribute('href'),
      isSubmit: input.type === 'submit' || el.getAttribute('type') === 'submit',
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
  collect('nav, [role="navigation"]', 'navigation', 'nav / role=navigation');
  collect('a[href]', 'link', '<a href>');
  collect('button, [role="button"], input[type="submit"], input[type="button"]', 'button', 'button / role=button');
  collect('textarea', 'textarea', '<textarea>');
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
