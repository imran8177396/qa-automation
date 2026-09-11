import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasApacheListingStructure, isAutoindexPage, isAutoindexTitle } from './autoindex';

const APACHE_PRE = `<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 3.2 Final//EN">
<html><head><title>Index of /work</title></head>
<body><h1>Index of /work</h1>
<pre><a href="?C=N;O=D">Name</a> <a href="?C=M;O=A">Last modified</a>
<a href="/">Parent Directory</a>
<a href="__next.work">__next.work</a>
</pre></body></html>`;

const APACHE_TABLE = `<html><head><title>Files</title></head>
<body><table>
<tr><th><a href="?C=N;O=D">Name</a></th></tr>
<tr><td><a href="/">Parent Directory</a></td></tr>
</table></body></html>`;

test('isAutoindexTitle() matches Apache Index of / titles', () => {
  assert.equal(isAutoindexTitle('Index of /'), true);
  assert.equal(isAutoindexTitle('Index of /work'), true);
  assert.equal(isAutoindexTitle('Index of /work/__next.work'), true);
  assert.equal(isAutoindexTitle('Index of something'), false);
  assert.equal(isAutoindexTitle('Welcome'), false);
});

test('isAutoindexPage() detects title-only fixture listings', () => {
  assert.equal(isAutoindexPage({ title: 'Index of /exposed' }), true);
  assert.equal(isAutoindexPage({ title: 'Home', html: '<h1>Welcome</h1>' }), false);
});

test('hasApacheListingStructure() detects <pre> + Parent Directory + ?C= links', () => {
  assert.equal(hasApacheListingStructure(APACHE_PRE), true);
  assert.equal(hasApacheListingStructure(APACHE_TABLE), true);
  assert.equal(hasApacheListingStructure('<p>Hello</p>'), false);
});

test('isAutoindexPage() detects structure even when the title is not Index of /', () => {
  assert.equal(isAutoindexPage({ title: 'Files', html: APACHE_TABLE }), true);
});
