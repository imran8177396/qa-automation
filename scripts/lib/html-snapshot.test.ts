import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, resolveHref, sameOrigin } from './html-snapshot';

test('parseHtml() extracts title, meta, canonical, OG, headings, images, and text', () => {
  const parsed = parseHtml(`
    <html>
      <head>
        <title>Swag Labs</title>
        <meta name="description" content="Demo login">
        <link rel="canonical" href="https://www.saucedemo.com/">
        <meta property="og:title" content="Swag Labs">
      </head>
      <body>
        <h4>Accepted usernames are:</h4>
        <img src="/logo.png" alt="">
        <a href="/inventory.html">Shop</a>
        <p>Visible copy</p>
        <script>TODO hide me</script>
      </body>
    </html>
  `);
  assert.equal(parsed.title, 'Swag Labs');
  assert.equal(parsed.metaDescription, 'Demo login');
  assert.equal(parsed.canonicalUrl, 'https://www.saucedemo.com/');
  assert.equal(parsed.ogTitle, 'Swag Labs');
  assert.equal(parsed.headings[0]?.level, 'h4');
  assert.equal(parsed.images[0]?.hasAltAttr, true);
  assert.equal(parsed.images[0]?.alt, '');
  assert.equal(parsed.links[0]?.href, '/inventory.html');
  assert.match(parsed.visibleText, /Visible copy/);
  assert.ok(!parsed.visibleText.includes('TODO hide me'));
});

test('resolveHref() and sameOrigin() stay origin-safe', () => {
  assert.equal(resolveHref('https://www.saucedemo.com/', '/x'), 'https://www.saucedemo.com/x');
  assert.equal(resolveHref('https://www.saucedemo.com/', 'javascript:void(0)'), null);
  assert.equal(sameOrigin('https://www.saucedemo.com/a', 'https://www.saucedemo.com/b'), true);
  assert.equal(sameOrigin('https://www.saucedemo.com/', 'https://jsonplaceholder.typicode.com/posts'), false);
});
