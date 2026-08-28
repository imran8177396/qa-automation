import fs from 'fs';
import path from 'path';

const rulesDir = path.resolve(__dirname, '../.cursor/rules');

for (const file of fs.readdirSync(rulesDir).filter((f) => f.endsWith('.json'))) {
  const full = path.join(rulesDir, file);
  const rule = JSON.parse(fs.readFileSync(full, 'utf8')) as {
    description: string;
    alwaysApply?: boolean;
    globs?: string[];
    body: string;
  };

  const globsLine =
    Array.isArray(rule.globs) && rule.globs.length ? `globs: ${rule.globs.join(',')}\n` : '';

  const mdc = `---\ndescription: ${rule.description}\n${globsLine}alwaysApply: ${Boolean(
    rule.alwaysApply
  )}\n---\n\n${rule.body.replace(/\n*$/, '\n')}`;

  const mdcPath = path.join(rulesDir, file.replace(/\.json$/i, '.mdc'));
  fs.writeFileSync(mdcPath, mdc, 'utf8');
  console.log(`Synced ${path.basename(mdcPath)}`);
}
