import type { DocBlock, DocMeta, ParsedDocument } from './types';

const META_PREFIX = '@';

function parseMetaLine(line: string, meta: DocMeta): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith(META_PREFIX)) {
    return;
  }

  const [key, ...rest] = trimmed.slice(1).split(' ');
  const value = rest.join(' ').trim();

  switch (key.toLowerCase()) {
    case 'title':
      meta.title = value;
      break;
    case 'author':
      meta.author = value;
      break;
    case 'date':
      meta.date = value;
      break;
    default:
      break;
  }
}

function parseTableRow(line: string): string[] {
  return line
    .split('|')
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function isTableSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Plain-text format:
 * - @title, @author, @date  → document metadata
 * - ## Heading 1
 * - ### Heading 2
 * - #### Heading 3
 * - Blank line separated paragraphs
 * - Lines starting with "- " → bullet list (consecutive lines grouped)
 * - Pipe tables: | Col | Col |
 */
export function parseTextDocument(content: string): ParsedDocument {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const meta: DocMeta = {
    title: 'Untitled Document',
    author: 'QA Automation',
    date: new Date().toISOString().slice(0, 10),
  };

  const blocks: DocBlock[] = [];
  let paragraphBuffer: string[] = [];
  let bulletBuffer: string[] = [];
  let tableBuffer: string[][] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }
    blocks.push({ type: 'paragraph', text: paragraphBuffer.join(' ').trim() });
    paragraphBuffer = [];
  };

  const flushBullets = () => {
    if (bulletBuffer.length === 0) {
      return;
    }
    blocks.push({ type: 'bullet', items: [...bulletBuffer] });
    bulletBuffer = [];
  };

  const flushTable = () => {
    if (tableBuffer.length < 2) {
      tableBuffer = [];
      return;
    }

    const [headerRow, ...bodyRows] = tableBuffer;
    blocks.push({
      type: 'table',
      headers: headerRow,
      rows: bodyRows,
    });
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith(META_PREFIX)) {
      flushParagraph();
      flushBullets();
      flushTable();
      parseMetaLine(line, meta);
      continue;
    }

    if (line.startsWith('#### ')) {
      flushParagraph();
      flushBullets();
      flushTable();
      blocks.push({ type: 'heading3', text: line.slice(5).trim() });
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushBullets();
      flushTable();
      blocks.push({ type: 'heading2', text: line.slice(4).trim() });
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushBullets();
      flushTable();
      blocks.push({ type: 'heading1', text: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      flushTable();
      bulletBuffer.push(line.slice(2).trim());
      continue;
    }

    if (line.includes('|')) {
      flushParagraph();
      flushBullets();
      const cells = parseTableRow(line);
      if (cells.length === 0) {
        continue;
      }
      if (isTableSeparator(cells)) {
        continue;
      }
      tableBuffer.push(cells);
      continue;
    }

    if (tableBuffer.length > 0 && line.trim() === '') {
      flushTable();
      continue;
    }

    if (tableBuffer.length > 0) {
      flushTable();
    }

    flushBullets();

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      meta.title = line.slice(2).trim();
      continue;
    }

    paragraphBuffer.push(line.trim());
  }

  flushParagraph();
  flushBullets();
  flushTable();

  return { meta, blocks };
}
