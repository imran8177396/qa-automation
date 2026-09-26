import { sanitizeDocxText } from '../../../npm-docs/sanitize-text';
import { rowsOrUnavailable } from './empty-table';
import type { MasterReportModel, MasterReportSection, MasterTable } from './master-report-model';
import {
  displaySectionStatus,
  kpiCardValue,
  statusTone,
  type MasterNormalizedSummary,
} from './master-report-summary';

function escapeHtml(text: string): string {
  return sanitizeDocxText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toneClass(status: string): string {
  return `tone-${statusTone(status)}`;
}

function statusBadge(status: string): string {
  const display = displaySectionStatus(status);
  return `<span class="badge ${toneClass(status)}">${escapeHtml(display)}</span>`;
}

function renderTable(table: MasterTable): string {
  const rows = rowsOrUnavailable(table.rows, table.headers.length, table.emptyReason);
  const head = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body = rows
    .map((row) => {
      const cells = table.headers.map((_, index) => {
        const header = table.headers[index] ?? '';
        const cell = row[index] ?? '';
        const isStatus =
          header.toLowerCase().includes('status') ||
          header.toLowerCase().includes('result') ||
          header.toLowerCase().includes('severity');
        const cls = isStatus ? toneClass(cell) : '';
        return `<td class="${cls}">${escapeHtml(cell)}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
  const caption = table.caption ? `<caption>${escapeHtml(table.caption)}</caption>` : '';
  return `<div class="table-wrap"><table>${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderEvidence(section: MasterReportSection): string {
  if (section.evidence.length === 0) return '';
  const items = section.evidence.map((row) => {
    if (!row.available) {
      return `<li><strong>${escapeHtml(row.kind)}</strong> — ${escapeHtml(row.label)}: UNAVAILABLE (${escapeHtml(row.path)})</li>`;
    }
    const href = escapeHtml(row.path);
    const isImage = /\.(png|jpe?g|gif|webp)$/i.test(row.path);
    const preview = isImage
      ? `<div class="shot"><a href="${href}"><img src="${href}" alt="${escapeHtml(row.label)}" /></a></div>`
      : '';
    return `<li><strong>${escapeHtml(row.kind)}</strong> — <a href="${href}">${escapeHtml(row.label)} (${escapeHtml(row.path)})</a>${preview}</li>`;
  });
  return `<h3>Evidence</h3><ul class="evidence-list">${items.join('')}</ul>`;
}

function subsection(title: string, html: string): string {
  if (!html.trim()) return '';
  return `<div class="subblock"><h3>${escapeHtml(title)}</h3>${html}</div>`;
}

function renderMetrics(section: MasterReportSection): string {
  if (section.fields.length === 0) return '';
  const cards = section.fields
    .map(
      (row) =>
        `<div class="metric"><span class="metric-label">${escapeHtml(row.label)}</span><span class="metric-value">${escapeHtml(row.value)}</span></div>`
    )
    .join('');
  return `<div class="metric-grid">${cards}</div>`;
}

function renderLists(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderParagraphs(lines: string[]): string {
  return lines
    .filter((line) => line.trim())
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
}

function renderDomainOrStandard(section: MasterReportSection): string {
  const findings = section.lists.filter((line) => line.trim());
  const limitations = section.limitations.filter((line) => line.trim());
  const status = section.displayStatus || displaySectionStatus(section.status);
  const emptyDomain =
    !section.dataAvailable && (status === 'NOT TESTED' || status === 'BLOCKED')
      ? `<p class="empty-state">${escapeHtml(section.summaryText || section.paragraphs.join(' '))}</p>`
      : '';
  return `
    <section class="report-section kind-${escapeHtml(section.kind)}" id="${escapeHtml(section.id)}">
      <div class="section-head">
        <h2>${escapeHtml(section.heading)}</h2>
        ${statusBadge(section.status)}
      </div>
      <div class="status-panel ${toneClass(section.status)}">STATUS: ${escapeHtml(status)}</div>
      ${section.unavailableReason ? `<p class="muted">${escapeHtml(section.unavailableReason)}</p>` : ''}
      ${emptyDomain}
      ${subsection('Summary', section.summaryText ? `<p>${escapeHtml(section.summaryText)}</p>` : renderParagraphs(section.paragraphs))}
      ${subsection('Metrics', renderMetrics(section))}
      ${subsection('Key Findings', renderLists(findings))}
      ${subsection('Test Results', section.tables.map(renderTable).join(''))}
      ${renderEvidence(section)}
      ${subsection('Limitations', renderLists(limitations))}
    </section>
  `;
}

function progressBar(percent: number | null, label: string): string {
  if (percent == null) return `<p class="muted">${escapeHtml(label)}: NOT_AVAILABLE</p>`;
  const width = Math.max(0, Math.min(100, percent));
  return `<div class="progress" role="img" aria-label="${escapeHtml(label)} ${width}%">
    <div class="progress-track"><div class="progress-fill" style="width:${width}%"></div></div>
    <span>${escapeHtml(label)} ${width}%</span>
  </div>`;
}

function distributionBars(summary: MasterNormalizedSummary): string {
  const rows = summary.failureDistribution;
  if (rows.length === 0) return '';
  const max = Math.max(...rows.map((row) => row.count), 1);
  return `<div class="dist">
    ${rows
      .map(
        (row) => `<div class="dist-row">
          <span class="dist-label">${escapeHtml(row.category)}</span>
          <span class="dist-bar"><span style="width:${(row.count / max) * 100}%"></span></span>
          <span class="dist-count">${row.count}</span>
        </div>`
      )
      .join('')}
  </div>`;
}

function renderCover(model: MasterReportModel): string {
  const cover = model.summary.cover;
  const meta: Array<[string, string | null]> = [
    ['Application', cover.applicationName],
    ['Application URL', cover.applicationUrl],
    ['Execution', cover.executionLongDate ?? cover.executionDateTime],
    ['Test Run', cover.testRunId],
    ['Environment', cover.environment],
    ['Framework version', cover.frameworkVersion],
    ['Report template version', cover.reportVersion],
  ];
  const rows = meta
    .filter(([, value]) => value)
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value as string)}</dd></div>`)
    .join('');
  const gate = cover.releaseStatus ?? model.overallStatus;
  return `
    <header class="cover">
      <p class="kicker">Quality assessment and release readiness</p>
      <h1>MASTER QA REPORT</h1>
      <dl class="cover-meta">${rows}</dl>
      <div class="release-banner ${toneClass(gate)}">
        <span>RELEASE STATUS</span>
        <strong>${escapeHtml(displaySectionStatus(gate))}</strong>
      </div>
    </header>
  `;
}

function renderExecutive(section: MasterReportSection, model: MasterReportModel): string {
  const kpis = model.summary.kpis;
  const release = model.summary.release;
  const cards = [
    ['Total Tests', kpiCardValue(kpis.totalTests)],
    ['Executed', kpiCardValue(kpis.executed)],
    ['Passed', kpiCardValue(kpis.passed), 'tone-pass'],
    ['Failed', kpiCardValue(kpis.failed), 'tone-fail'],
    ['Blocked', kpiCardValue(kpis.blocked), 'tone-blocked'],
    ['Not Tested', kpiCardValue(kpis.notTested), 'tone-not-tested'],
    ['Coverage', kpiCardValue(kpis.coveragePercent, '%')],
    ['Pass Rate', kpiCardValue(kpis.passRatePercent, '%')],
  ] as Array<[string, string, string?]>;
  const blockers = release.blockers.length
    ? `<ul>${release.blockers.map((row) => `<li><strong>${escapeHtml(row.area)}</strong> — ${escapeHtml(row.detail)}</li>`).join('')}</ul>`
    : `<p>${escapeHtml(release.headline)}</p>`;
  return `
    <section class="report-section kind-executive" id="${escapeHtml(section.id)}">
      <div class="section-head">
        <h2>${escapeHtml(section.heading)}</h2>
        ${statusBadge(section.status)}
      </div>
      <div class="gate-panel ${toneClass(release.gate ?? section.status)}">
        <p class="gate-kicker">RELEASE QUALITY GATE</p>
        <p class="gate-status">${escapeHtml(displaySectionStatus(release.gate ?? section.status))}</p>
        <p>${escapeHtml(release.headline)}</p>
        ${blockers}
      </div>
      <div class="kpi-grid">
        ${cards
          .map(
            ([label, value, extra]) =>
              `<article class="kpi ${extra ?? ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`
          )
          .join('')}
      </div>
      ${progressBar(kpis.coveragePercent, 'Coverage')}
      ${progressBar(kpis.passRatePercent, 'Pass rate')}
      <p class="muted">${escapeHtml(kpis.identity.fourWayNote)}</p>
      ${section.tables.map(renderTable).join('')}
    </section>
  `;
}

function renderCoverageVisual(section: MasterReportSection, model: MasterReportModel): string {
  const kpis = model.summary.kpis;
  return `
    <section class="report-section" id="${escapeHtml(section.id)}">
      <div class="section-head">
        <h2>${escapeHtml(section.heading)}</h2>
        ${statusBadge(section.status)}
      </div>
      <div class="stack-legend">
        <span class="badge tone-pass">TESTED</span>
        <span class="badge tone-not-tested">NOT TESTED</span>
        <span class="badge tone-blocked">BLOCKED</span>
      </div>
      ${progressBar(kpis.coveragePercent, 'Item coverage')}
      ${renderMetrics(section)}
      ${section.tables.map(renderTable).join('')}
      ${renderLists(section.lists)}
    </section>
  `;
}

function renderFailureAnalysis(section: MasterReportSection, model: MasterReportModel): string {
  const distTable = section.tables[0];
  const detailTables = section.tables.slice(1);
  return `
    <section class="report-section" id="${escapeHtml(section.id)}">
      <div class="section-head">
        <h2>${escapeHtml(section.heading)}</h2>
        ${statusBadge(section.status)}
      </div>
      ${subsection('Summary', section.summaryText ? `<p>${escapeHtml(section.summaryText)}</p>` : '')}
      <h3>Failure distribution</h3>
      ${distributionBars(model.summary)}
      ${distTable ? renderTable(distTable) : ''}
      ${renderMetrics(section)}
      ${detailTables.map(renderTable).join('')}
      ${renderEvidence(section)}
    </section>
  `;
}

function renderAssessment(section: MasterReportSection, model: MasterReportModel): string {
  const kpis = model.summary.kpis;
  const gate = model.summary.release.gate ?? section.status;
  return `
    <section class="report-section kind-assessment" id="${escapeHtml(section.id)}">
      <div class="section-head">
        <h2>${escapeHtml(section.heading)}</h2>
        ${statusBadge(section.status)}
      </div>
      <div class="gate-panel ${toneClass(gate)}">
        <p class="gate-kicker">Release Gate</p>
        <p class="gate-status">${escapeHtml(displaySectionStatus(gate))}</p>
      </div>
      <h3>Summary</h3>
      ${renderParagraphs(section.paragraphs)}
      <div class="kpi-grid compact">
        <article class="kpi"><span>Coverage</span><strong>${escapeHtml(kpiCardValue(kpis.coveragePercent, '%'))}</strong></article>
        <article class="kpi"><span>Executed</span><strong>${escapeHtml(kpiCardValue(kpis.executed))}</strong></article>
        <article class="kpi"><span>Passed</span><strong>${escapeHtml(kpiCardValue(kpis.passed))}</strong></article>
        <article class="kpi"><span>Failed</span><strong>${escapeHtml(kpiCardValue(kpis.failed))}</strong></article>
        <article class="kpi"><span>Blocked</span><strong>${escapeHtml(kpiCardValue(kpis.blocked))}</strong></article>
        <article class="kpi"><span>Not Tested</span><strong>${escapeHtml(kpiCardValue(kpis.notTested))}</strong></article>
      </div>
      ${section.tables.map(renderTable).join('')}
      ${subsection('Assessment Limitations', renderLists(section.limitations.length ? section.limitations : section.lists))}
    </section>
  `;
}

function renderSection(section: MasterReportSection, model: MasterReportModel): string {
  if (section.id === 'executive-summary') return renderExecutive(section, model);
  if (section.id === 'coverage') return renderCoverageVisual(section, model);
  if (section.id === 'failure-analysis') return renderFailureAnalysis(section, model);
  if (section.id === 'release-quality-assessment') return renderAssessment(section, model);
  return renderDomainOrStandard(section);
}

function renderToc(model: MasterReportModel): string {
  const numbered = model.sections.filter((row) => row.kind !== 'appendix');
  const appendices = model.sections.filter((row) => row.kind === 'appendix');
  const item = (section: MasterReportSection) =>
    `<li><a href="#${escapeHtml(section.id)}">${escapeHtml(section.heading)}</a> ${statusBadge(section.status)}</li>`;
  return `
    <nav class="toc" aria-label="Report contents">
      <h2>Contents</h2>
      <ol>${numbered.map(item).join('')}</ol>
      ${appendices.length ? `<h3>Appendices</h3><ul>${appendices.map(item).join('')}</ul>` : ''}
    </nav>
  `;
}

export function generateMasterReportHtml(model: MasterReportModel): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MASTER QA REPORT — ${escapeHtml(model.projectName)} — ${escapeHtml(model.executionId)}</title>
  <style>
    :root {
      --navy: #102a43;
      --navy-2: #243b53;
      --text: #243b53;
      --muted: #627d98;
      --line: #d9e2ec;
      --bg: #f0f4f8;
      --card: #ffffff;
      --pass: #0f766e;
      --pass-bg: #ccfbf1;
      --fail: #b91c1c;
      --fail-bg: #fee2e2;
      --blocked: #c2410c;
      --blocked-bg: #ffedd5;
      --neutral: #475569;
      --neutral-bg: #e2e8f0;
      --info: #1d4ed8;
      --info-bg: #dbeafe;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Calibri, Arial, sans-serif;
      color: var(--text);
      background: var(--bg);
      line-height: 1.5;
    }
    .page { max-width: 1180px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    .sheet { background: var(--card); padding: 2rem 2.25rem 3rem; box-shadow: 0 1px 4px rgba(16,42,67,.08); }
    h1 { color: var(--navy); font-size: 2.35rem; letter-spacing: .02em; margin: 0 0 .75rem; }
    h2 { color: var(--navy); font-size: 1.45rem; margin: 0; }
    h3 { color: var(--navy-2); font-size: 1.05rem; margin: 1.1rem 0 .45rem; }
    .kicker { text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-size: .75rem; margin: 0 0 .35rem; }
    .cover { border-bottom: 3px solid var(--navy); padding-bottom: 1.5rem; margin-bottom: 1.5rem; }
    .cover-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: .65rem 1.25rem; margin: 1rem 0 1.25rem; }
    .cover-meta div { margin: 0; }
    .cover-meta dt { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .cover-meta dd { margin: .1rem 0 0; font-weight: 600; word-break: break-word; }
    .release-banner, .gate-panel, .status-panel {
      border-radius: 6px;
      padding: .85rem 1rem;
      margin: .75rem 0 1rem;
    }
    .release-banner span, .gate-kicker { display: block; font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; }
    .release-banner strong, .gate-status { font-size: 1.8rem; display: block; line-height: 1.2; }
    .tone-pass { color: var(--pass); }
    .tone-fail { color: var(--fail); }
    .tone-blocked { color: var(--blocked); }
    .tone-not-tested { color: var(--neutral); }
    .tone-info { color: var(--info); }
    .badge { display: inline-block; font-size: .75rem; font-weight: 700; padding: .15rem .5rem; border-radius: 999px; background: var(--neutral-bg); }
    .badge.tone-pass { background: var(--pass-bg); }
    .badge.tone-fail { background: var(--fail-bg); }
    .badge.tone-blocked { background: var(--blocked-bg); }
    .badge.tone-not-tested { background: var(--neutral-bg); }
    .badge.tone-info { background: var(--info-bg); }
    .release-banner.tone-pass, .gate-panel.tone-pass, .status-panel.tone-pass { background: var(--pass-bg); }
    .release-banner.tone-fail, .gate-panel.tone-fail, .status-panel.tone-fail { background: var(--fail-bg); }
    .release-banner.tone-blocked, .gate-panel.tone-blocked, .status-panel.tone-blocked { background: var(--blocked-bg); }
    .release-banner.tone-not-tested, .gate-panel.tone-not-tested, .status-panel.tone-not-tested { background: var(--neutral-bg); }
    .release-banner.tone-info, .gate-panel.tone-info, .status-panel.tone-info { background: var(--info-bg); }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin: 1rem 0; }
    .kpi-grid.compact { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .kpi { border: 1px solid var(--line); border-radius: 8px; padding: .8rem .9rem; background: #fff; }
    .kpi span { display: block; color: var(--muted); font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; }
    .kpi strong { font-size: 1.55rem; color: var(--navy); }
    .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: .55rem; }
    .metric { border: 1px solid var(--line); border-radius: 6px; padding: .55rem .7rem; }
    .metric-label { display: block; color: var(--muted); font-size: .75rem; }
    .metric-value { font-weight: 700; word-break: break-word; }
    .progress { display: flex; align-items: center; gap: .75rem; margin: .45rem 0 1rem; }
    .progress-track { flex: 1; height: 10px; background: var(--neutral-bg); border-radius: 999px; overflow: hidden; }
    .progress-fill { height: 100%; background: var(--navy); }
    .dist { display: grid; gap: .4rem; margin: .75rem 0 1rem; }
    .dist-row { display: grid; grid-template-columns: minmax(8rem, 16rem) 1fr 3rem; gap: .6rem; align-items: center; }
    .dist-bar { background: var(--neutral-bg); height: 10px; border-radius: 999px; overflow: hidden; }
    .dist-bar span { display: block; height: 100%; background: var(--fail); }
    .dist-count { text-align: right; font-weight: 700; }
    .report-section { margin-top: 2.25rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: .6rem; }
    .table-wrap { overflow-x: auto; margin: .7rem 0 1.1rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; table-layout: auto; }
    caption { text-align: left; font-weight: 700; color: var(--navy); padding-bottom: .35rem; }
    th, td { border: 1px solid var(--line); padding: .45rem .6rem; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
    th { background: #e8eef7; color: var(--navy); }
    td.tone-pass, td.tone-fail, td.tone-blocked, td.tone-not-tested { font-weight: 700; }
    .muted, .empty-state { color: var(--muted); }
    .toc ol, .toc ul { padding-left: 1.2rem; }
    .toc li { margin: .25rem 0; }
    .shot img { max-width: 280px; height: auto; border: 1px solid var(--line); margin-top: .35rem; }
    .stack-legend { display: flex; gap: .5rem; flex-wrap: wrap; margin: .4rem 0 1rem; }
    @media (max-width: 860px) {
      .sheet { padding: 1.15rem 1rem 2rem; }
      h1 { font-size: 1.7rem; }
      .kpi-grid, .kpi-grid.compact { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .section-head { flex-direction: column; align-items: flex-start; }
      .dist-row { grid-template-columns: 1fr; }
      .shot img { max-width: 100%; }
    }
    @media (max-width: 560px) {
      .kpi-grid, .kpi-grid.compact { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="page"><div class="sheet">
    ${renderCover(model)}
    <p class="muted">This report embeds summarized results from this execution. Missing modules stay NOT TESTED / BLOCKED / N/A. Results were not fabricated. Allure is a supporting viewer when present.</p>
    <p class="muted">${escapeHtml(model.allure.note)}</p>
    ${model.allure.available ? `<p>Allure (supporting): <a href="${escapeHtml(model.allure.href)}">${escapeHtml(model.allure.href)}</a></p>` : ''}
    ${renderToc(model)}
    ${model.sections.map((section) => renderSection(section, model)).join('\n')}
  </div></div>
</body>
</html>
`;
}
