import fs from 'fs';
import path from 'path';
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { DocBlock, DocsConfig, ParsedDocument } from './types';
import { sanitizeDocxText } from './sanitize-text';

function normalizeTable(block: Extract<DocBlock, { type: 'table' }>): {
  headers: string[];
  rows: string[][];
} {
  const headers = block.headers.map(sanitizeDocxText);
  const colCount = headers.length;

  const rows = block.rows.map((row) => {
    const normalized = row.map(sanitizeDocxText);
    while (normalized.length < colCount) {
      normalized.push('');
    }
    return normalized.slice(0, colCount);
  });

  return { headers, rows };
}

function textRun(text: string, config: DocsConfig['document'], options: { bold?: boolean; size?: number } = {}) {
  return new TextRun({
    text: sanitizeDocxText(text),
    font: config.font,
    size: options.size ?? config.fontSize,
    bold: options.bold,
  });
}

function blockToContent(
  block: DocBlock,
  config: DocsConfig['document']
): Array<Paragraph | Table> {
  switch (block.type) {
    case 'heading1':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: sanitizeDocxText(block.text),
              bold: true,
              color: config.headingColor,
              font: config.font,
            }),
          ],
        }),
      ];
    case 'heading2':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: sanitizeDocxText(block.text),
              bold: true,
              color: config.headingColor,
              font: config.font,
            }),
          ],
        }),
      ];
    case 'heading3':
      return [
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 },
          children: [
            new TextRun({
              text: sanitizeDocxText(block.text),
              bold: true,
              color: config.headingColor,
              font: config.font,
            }),
          ],
        }),
      ];
    case 'paragraph':
      return [
        new Paragraph({
          spacing: { after: 180, line: 276 },
          children: [
            new TextRun({
              text: sanitizeDocxText(block.text),
              font: config.font,
              size: config.fontSize,
            }),
          ],
        }),
      ];
    case 'bullet':
      return block.items.map(
        (item) =>
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: sanitizeDocxText(item),
                font: config.font,
                size: config.fontSize,
              }),
            ],
          })
      );
    case 'table': {
      const table = normalizeTable(block);
      return [
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: table.headers.map(
                (header) =>
                  new TableCell({
                    shading: { fill: 'D9E2F3' },
                    children: [
                      new Paragraph({
                        children: [textRun(header, config, { bold: true })],
                      }),
                    ],
                  })
              ),
            }),
            ...table.rows.map(
              (row) =>
                new TableRow({
                  children: row.map(
                    (cell) =>
                      new TableCell({
                        children: [
                          new Paragraph({
                            children: [textRun(cell, config)],
                          }),
                        ],
                      })
                  ),
                })
            ),
          ],
        }),
        new Paragraph({ children: [new TextRun({ text: '' })] }),
      ] as Array<Paragraph | Table>;
    }
    default:
      return [];
  }
}

export async function generateWordDocument(
  parsed: ParsedDocument,
  config: DocsConfig
): Promise<Buffer> {
  const docConfig = config.document;
  const title = parsed.meta.title || docConfig.title;

  const cover = [
    new Paragraph({ spacing: { before: 2400 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: sanitizeDocxText(title),
          bold: true,
          size: 48,
          color: docConfig.headingColor,
          font: docConfig.font,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240 },
      children: [
        new TextRun({
          text: sanitizeDocxText(`Author: ${parsed.meta.author}`),
          size: 24,
          font: docConfig.font,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [
        new TextRun({
          text: sanitizeDocxText(`Date: ${parsed.meta.date}`),
          size: 24,
          font: docConfig.font,
        }),
      ],
    }),
    new Paragraph({
      children: [new TextRun({ text: '', break: 1 })],
      pageBreakBefore: false,
    }),
  ];

  const body = parsed.blocks.flatMap((block) => blockToContent(block, docConfig));

  const doc = new Document({
    creator: parsed.meta.author,
    title: sanitizeDocxText(title),
    description: 'Generated by npm-docs from plain text',
    compatibility: {
      version: 15,
    },
    sections: [
      {
        properties: {
          page: {
            margin: docConfig.margins,
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: sanitizeDocxText(title),
                    italics: true,
                    size: 18,
                    color: '666666',
                    font: docConfig.font,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: 'Page ',
                    size: 18,
                    font: docConfig.font,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    font: docConfig.font,
                  }),
                ],
              }),
            ],
          }),
        },
        children: [...cover, ...body],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export async function writeWordDocument(
  parsed: ParsedDocument,
  config: DocsConfig,
  outputPath: string
): Promise<string> {
  const buffer = await generateWordDocument(parsed, config);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, buffer);
  fs.renameSync(tempPath, outputPath);

  return outputPath;
}
