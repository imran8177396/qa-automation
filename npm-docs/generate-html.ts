import fs from 'fs';
import path from 'path';
import type { DocBlock, ParsedDocument } from './types';
import { sanitizeDocxText } from './sanitize-text';

function escapeHtml(text: string): string {
  return sanitizeDocxText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blockToHtml(block: DocBlock): string {
  switch (block.type) {
    case 'heading1':
      return `<h2>${escapeHtml(block.text)}</h2>`;
    case 'heading2':
      return `<h3>${escapeHtml(block.text)}</h3>`;
    case 'heading3':
      return `<h4>${escapeHtml(block.text)}</h4>`;
    case 'paragraph':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'bullet':
      return `<ul>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    case 'table': {
      const header = block.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('');
      const rows = block.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    default:
      return '';
  }
}

export function generateHtmlDocument(parsed: ParsedDocument): string {
  const title = escapeHtml(parsed.meta.title);
  const body = parsed.blocks.map(blockToHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: Calibri, Segoe UI, Arial, sans-serif; margin: 2rem auto; max-width: 960px; line-height: 1.5; color: #1f2937; }
    h1 { color: #1f3864; border-bottom: 2px solid #d9e2f3; padding-bottom: 0.5rem; }
    h2, h3, h4 { color: #1f3864; margin-top: 1.5rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { border: 1px solid #cbd5e1; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
    th { background: #d9e2f3; }
    ul { padding-left: 1.25rem; }
    .meta { color: #64748b; margin-bottom: 2rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="meta">
    <div><strong>Author:</strong> ${escapeHtml(parsed.meta.author)}</div>
    <div><strong>Date:</strong> ${escapeHtml(parsed.meta.date)}</div>
  </div>
  ${body}
</body>
</html>
`;
}

export function writeHtmlDocument(parsed: ParsedDocument, outputPath: string): string {
  const html = generateHtmlDocument(parsed);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf8');
  return outputPath;
}
