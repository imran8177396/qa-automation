import fs from 'fs';
import path from 'path';
import { parseTextDocument, writeWordDocument } from '../npm-docs';
import type { DocsConfig } from '../npm-docs/types';

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'docs.config.json');

function loadConfig(): DocsConfig {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as DocsConfig;
}

function resolveInputPath(config: DocsConfig): string {
  const argPath = process.argv.find((arg) => arg.startsWith('--input='))?.split('=')[1];
  const input = argPath ?? config.defaultInput;
  return path.isAbsolute(input) ? input : path.join(ROOT, input);
}

function resolveOutputPath(config: DocsConfig, inputPath: string): string {
  const argPath = process.argv.find((arg) => arg.startsWith('--output='))?.split('=')[1];
  if (argPath) {
    return path.isAbsolute(argPath) ? argPath : path.join(ROOT, argPath);
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  return path.join(ROOT, config.outputDir, `${baseName}.docx`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const inputPath = resolveInputPath(config);
  const outputPath = resolveOutputPath(config, inputPath);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  console.log(`Reading: ${inputPath}`);
  const content = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseTextDocument(content);

  console.log(`Generating Word document...`);
  await writeWordDocument(parsed, config, outputPath);

  console.log(`Done: ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
