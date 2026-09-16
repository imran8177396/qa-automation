import type { ApiDiscoveryProvenance } from './discovery-source';
import type { ApiSection27Artifact, ApiSection27Request } from './types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sourceLabel(row: ApiSection27Request): string {
  if (row.result === 'NOT_EXECUTED') return 'capability (not executed)';
  return row.source ?? 'config';
}

export function renderApiFindingsMarkdown(
  artifact: ApiSection27Artifact,
  discovery: ApiDiscoveryProvenance
): string {
  const lines = [
    '# API findings (Postman CLI)',
    '',
    discovery.note,
    '',
    `- Website: ${discovery.websiteUrl}`,
    `- Discovery inventory present: ${discovery.inventoryPresent ? 'yes' : 'no'}`,
    `- Observed xhr/fetch/websocket calls: ${discovery.observedCallCount}`,
    `- Executed request source: qa.config.json postman.requests (not discovery, not invented Sauce Demo REST)`,
    `- Authentication: ${artifact.auth.authentication}`,
    `- Authorization: ${artifact.auth.authorization}`,
    `- Auth reason: ${artifact.auth.reason}`,
    `- Counts: PASS ${artifact.counts.passed}, FAIL ${artifact.counts.failed}, UNVERIFIED ${artifact.counts.unverified}, NOT_EXECUTED ${artifact.counts.notExecuted}`,
    '',
    '| Test ID | Source | Method | Path | Result | Expected | Actual |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of artifact.requests) {
    const expected = row.expectedVsActual?.expected ?? String(row.expectedStatus);
    const actual = row.expectedVsActual?.actual ?? row.statusCode;
    lines.push(
      `| ${row.testId} | ${sourceLabel(row)} | ${row.method} | ${row.path} | ${row.result} | ${expected} | ${actual} |`
    );
  }

  lines.push('', artifact.terminology, '');
  return `${lines.join('\n')}\n`;
}

export function renderApiFindingsHtml(
  artifact: ApiSection27Artifact,
  discovery: ApiDiscoveryProvenance
): string {
  const rows = artifact.requests
    .map((row) => {
      const expected = escapeHtml(row.expectedVsActual?.expected ?? String(row.expectedStatus));
      const actual = escapeHtml(row.expectedVsActual?.actual ?? row.statusCode);
      return `<tr><td>${escapeHtml(row.testId)}</td><td>${escapeHtml(sourceLabel(row))}</td><td>${escapeHtml(row.method)}</td><td>${escapeHtml(row.path)}</td><td>${escapeHtml(row.result)}</td><td>${expected}</td><td>${actual}</td></tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>API findings (Postman CLI)</title>
</head>
<body>
  <h1>API findings (Postman CLI)</h1>
  <p>${escapeHtml(discovery.note)}</p>
  <ul>
    <li>Website: ${escapeHtml(discovery.websiteUrl)}</li>
    <li>Discovery inventory present: ${discovery.inventoryPresent ? 'yes' : 'no'}</li>
    <li>Observed xhr/fetch/websocket calls: ${discovery.observedCallCount}</li>
    <li>Executed request source: qa.config.json postman.requests</li>
    <li>Authentication: ${escapeHtml(artifact.auth.authentication)}</li>
    <li>Authorization: ${escapeHtml(artifact.auth.authorization)}</li>
    <li>Auth reason: ${escapeHtml(artifact.auth.reason)}</li>
    <li>PASS ${artifact.counts.passed} / FAIL ${artifact.counts.failed} / UNVERIFIED ${artifact.counts.unverified} / NOT_EXECUTED ${artifact.counts.notExecuted}</li>
  </ul>
  <table>
    <thead><tr><th>Test ID</th><th>Source</th><th>Method</th><th>Path</th><th>Result</th><th>Expected</th><th>Actual</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p>${escapeHtml(artifact.terminology)}</p>
</body>
</html>
`;
}
