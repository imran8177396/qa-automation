import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { PATHS } from '../lib/paths';

function findTestFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Passing explicit file paths (rather than a directory) to `tsx --test` avoids
// ERR_UNSUPPORTED_DIR_IMPORT from tsx's ESM loader hooks, and sidesteps shell glob-expansion
// differences between PowerShell and POSIX shells entirely.
const testFiles = findTestFiles(path.join(PATHS.root, 'scripts'));

if (testFiles.length === 0) {
  console.log('No unit test files found (*.test.ts under scripts/).');
  process.exit(0);
}

const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', '--test-reporter=spec', ...testFiles], {
  stdio: 'inherit',
  cwd: PATHS.root,
});

process.exit(result.status ?? 1);
