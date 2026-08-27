export interface DocMeta {
  title: string;
  author: string;
  date: string;
}

export type DocBlock =
  | { type: 'heading1'; text: string }
  | { type: 'heading2'; text: string }
  | { type: 'heading3'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

export interface ParsedDocument {
  meta: DocMeta;
  blocks: DocBlock[];
}

export interface DocsConfig {
  inputDir: string;
  outputDir: string;
  defaultInput: string;
  document: {
    title: string;
    author: string;
    font: string;
    fontSize: number;
    headingColor: string;
    margins: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
}
