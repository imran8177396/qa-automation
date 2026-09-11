import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { PATHS } from './lib/paths';
import { loadConfig } from './lib/load-config';
import { logStep } from './lib/logger';
import { resolveJmeterCommand } from './lib/jmeter';
import { resolvePlaywrightBrowsers, type PlaywrightBrowser } from './lib/playwright-browsers';
import { assertUniquePlaywrightSuitePaths } from './lib/playwright-suites';
import { resolvePostmanCommand } from './lib/postman';
import { captureCommand, findOnPath, localBinPath } from './lib/run-command';
import type { QaConfig } from './types';

type CheckStatus = 'PASS' | 'FAIL' | 'WARNING';

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  required: boolean;
}

const MIN_NODE_MAJOR = 18;
const SECRET_ENV_KEY = /password|secret|token|key|credential|authorization/i;
const SECRET_PATH = /(^|[\\/])\.env($|\.)|credentials|secret|\.pem$|\.pfx$/i;

const INSPECTED_ENV_KEYS = [
  'QA_WEBSITE_URL',
  'QA_API_URL',
  'QA_PLAYWRIGHT_BASE_URL',
  'QA_PLAYWRIGHT_HEADLESS',
  'QA_PLAYWRIGHT_BROWSERS',
  'QA_USERNAME',
  'QA_PASSWORD',
  'QA_LOGIN_URL',
  'JMETER_HOME',
  'QA_PERF_AUTHORIZE',
  'CI',
  'NODE_ENV',
];

function firstLine(...parts: string[]): string {
  const lines = parts
    .join('\n')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((line) => !/^(WARN|ERROR|INFO|DEBUG)\b/i.test(line));

  return lines[0] ?? '';
}

function isSpawnError(text: string): boolean {
  return /is not recognized|not found|ENOENT|command failed/i.test(text);
}

function nodeMajor(version: string): number {
  const match = version.replace(/^v/, '').match(/^(\d+)/);
  return match ? Number(match[1]) : 0;
}

function packageJsonPath(): string {
  return path.join(PATHS.root, 'package.json');
}

function readPackageJson(): { name?: string; version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } {
  return JSON.parse(fs.readFileSync(packageJsonPath(), 'utf8')) as {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function describeEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') return 'unset';
  if (SECRET_ENV_KEY.test(key)) return 'set (hidden)';
  return 'set';
}

function checkNode(): CheckResult {
  const version = process.version;
  const major = nodeMajor(version);
  if (major < MIN_NODE_MAJOR) {
    return {
      name: 'Node.js',
      status: 'FAIL',
      detail: `${version} (need >= ${MIN_NODE_MAJOR})`,
      required: true,
    };
  }
  return { name: 'Node.js', status: 'PASS', detail: version, required: true };
}

function checkNpm(): CheckResult {
  const npmBesideNode = path.join(
    path.dirname(process.execPath),
    process.platform === 'win32' ? 'npm.cmd' : 'npm'
  );
  const npmCommand = fs.existsSync(npmBesideNode) ? npmBesideNode : findOnPath('npm');
  if (!npmCommand) {
    return { name: 'npm', status: 'FAIL', detail: 'not found on PATH', required: true };
  }

  const captured = captureCommand(npmCommand, ['--version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  const version = firstLine(captured.stdout, captured.stderr);
  if (captured.status !== 0 || !version || isSpawnError(combined)) {
    return { name: 'npm', status: 'FAIL', detail: 'found but --version failed', required: true };
  }
  return { name: 'npm', status: 'PASS', detail: version, required: true };
}

function checkGit(): CheckResult {
  const git = findOnPath('git');
  if (!git) {
    return { name: 'Git', status: 'WARNING', detail: 'not found on PATH (version control unavailable)', required: false };
  }

  const captured = captureCommand(git, ['--version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  if (captured.status !== 0 || isSpawnError(combined)) {
    return { name: 'Git', status: 'WARNING', detail: 'found on PATH but --version failed', required: false };
  }
  return { name: 'Git', status: 'PASS', detail: firstLine(captured.stdout, captured.stderr) || 'found', required: false };
}

function checkJava(): CheckResult {
  const java = findOnPath('java');
  if (!java) {
    return {
      name: 'Java',
      status: 'WARNING',
      detail: 'not found on PATH (required to run JMeter)',
      required: false,
    };
  }

  const captured = captureCommand(java, ['-version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  if (isSpawnError(combined) && !/version/i.test(combined)) {
    return { name: 'Java', status: 'WARNING', detail: 'found on PATH but -version failed', required: false };
  }
  const version = firstLine(captured.stderr, captured.stdout) || 'found';
  const javac = findOnPath('javac');
  const detail = javac ? version : `${version} (JRE only — javac not on PATH)`;
  return { name: 'Java', status: 'PASS', detail, required: false };
}

function checkJmeter(config: QaConfig | null): CheckResult {
  const command = resolveJmeterCommand();
  const enabled = config?.jmeter.enabled !== false;
  if (!command) {
    return {
      name: 'JMeter',
      status: 'WARNING',
      detail: enabled
        ? 'not found (set JMETER_HOME or add jmeter to PATH — load step will skip)'
        : 'not found (jmeter disabled in qa.config.json)',
      required: false,
    };
  }

  const captured = captureCommand(command, ['-v'], { timeoutMs: 15000 });
  const combined = `${captured.stdout}\n${captured.stderr}`;
  const versionMatch = combined.match(/\b(\d+\.\d+\.\d+)\b/);
  const source = process.env.JMETER_HOME ? 'JMETER_HOME' : 'PATH';
  if (isSpawnError(combined) && !versionMatch) {
    return {
      name: 'JMeter',
      status: 'WARNING',
      detail: `found via ${source} but version check failed`,
      required: false,
    };
  }
  return {
    name: 'JMeter',
    status: 'PASS',
    detail: versionMatch ? versionMatch[1] : firstLine(captured.stdout, captured.stderr) || `found via ${source}`,
    required: false,
  };
}

function checkPostman(config: QaConfig | null): CheckResult {
  const enabled = config?.postman.enabled !== false;
  const command = resolvePostmanCommand();
  if (!fs.existsSync(command) && !findOnPath('postman')) {
    return {
      name: 'Postman CLI',
      status: enabled ? 'FAIL' : 'WARNING',
      detail: 'not found in node_modules/.bin or PATH',
      required: enabled,
    };
  }

  const captured = captureCommand(command, ['--version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  const version = firstLine(captured.stdout, captured.stderr);
  if ((captured.status !== 0 && !version) || isSpawnError(combined)) {
    return {
      name: 'Postman CLI',
      status: enabled ? 'FAIL' : 'WARNING',
      detail: 'found but --version failed',
      required: enabled,
    };
  }
  return { name: 'Postman CLI', status: 'PASS', detail: version || 'found', required: enabled };
}

function checkPlaywrightSuitePaths(): CheckResult {
  try {
    assertUniquePlaywrightSuitePaths();
    return {
      name: 'Playwright suite paths',
      status: 'PASS',
      detail: 'each suite writes to reports/playwright/<suite>/results.json',
      required: true,
    };
  } catch (error) {
    return {
      name: 'Playwright suite paths',
      status: 'FAIL',
      detail: error instanceof Error ? error.message : String(error),
      required: true,
    };
  }
}

function checkPlaywright(): CheckResult {
  const pkgDir = path.join(PATHS.root, 'node_modules', '@playwright', 'test');
  if (!fs.existsSync(pkgDir)) {
    return {
      name: 'Playwright',
      status: 'FAIL',
      detail: '@playwright/test is not installed',
      required: true,
    };
  }

  const bin = localBinPath('playwright');
  if (!fs.existsSync(bin)) {
    return { name: 'Playwright', status: 'FAIL', detail: 'playwright CLI missing from node_modules/.bin', required: true };
  }

  const captured = captureCommand(bin, ['--version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  const version = firstLine(captured.stdout, captured.stderr);
  if (!version || isSpawnError(combined)) {
    return { name: 'Playwright', status: 'FAIL', detail: 'CLI found but --version failed', required: true };
  }
  return { name: 'Playwright', status: 'PASS', detail: version, required: true };
}

function checkBrowsers(config: QaConfig | null): CheckResult {
  const needed = config
    ? resolvePlaywrightBrowsers(config.playwright)
    : (['chromium'] as PlaywrightBrowser[]);

  let playwright: typeof import('@playwright/test');
  try {
    playwright = createRequire(__filename)('@playwright/test') as typeof import('@playwright/test');
  } catch {
    return {
      name: 'Browsers',
      status: 'FAIL',
      detail: 'cannot import @playwright/test',
      required: true,
    };
  }

  const types = {
    chromium: playwright.chromium,
    firefox: playwright.firefox,
    webkit: playwright.webkit,
  };

  const missing: string[] = [];
  const present: string[] = [];

  for (const name of needed) {
    const executable = types[name].executablePath();
    if (fs.existsSync(executable)) {
      present.push(name);
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    return {
      name: 'Browsers',
      status: 'FAIL',
      detail: `missing ${missing.join(', ')} — run: npx playwright install ${missing.join(' ')}`,
      required: true,
    };
  }

  return { name: 'Browsers', status: 'PASS', detail: present.join(', '), required: true };
}

function checkTypeScript(): CheckResult {
  const pkgDir = path.join(PATHS.root, 'node_modules', 'typescript');
  const tsc = localBinPath('tsc');
  if (!fs.existsSync(pkgDir) || !fs.existsSync(tsc)) {
    return {
      name: 'TypeScript',
      status: 'FAIL',
      detail: 'typescript / tsc not installed in this project',
      required: true,
    };
  }

  const captured = captureCommand(tsc, ['--version']);
  const combined = `${captured.stdout}\n${captured.stderr}`;
  const version = firstLine(captured.stdout, captured.stderr);
  if (!version || isSpawnError(combined)) {
    return { name: 'TypeScript', status: 'FAIL', detail: 'tsc found but --version failed', required: true };
  }
  return { name: 'TypeScript', status: 'PASS', detail: version, required: true };
}

function checkDependencies(): CheckResult {
  const nodeModules = path.join(PATHS.root, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    return {
      name: 'Dependencies',
      status: 'FAIL',
      detail: 'node_modules/ missing — run npm install',
      required: true,
    };
  }

  let pkg: ReturnType<typeof readPackageJson>;
  try {
    pkg = readPackageJson();
  } catch (error) {
    return {
      name: 'Dependencies',
      status: 'FAIL',
      detail: `cannot read package.json: ${String(error)}`,
      required: true,
    };
  }

  const declared = { ...pkg.dependencies, ...pkg.devDependencies };
  const names = Object.keys(declared);
  const missing = names.filter((name) => !fs.existsSync(path.join(nodeModules, ...name.split('/'))));

  if (missing.length > 0) {
    return {
      name: 'Dependencies',
      status: 'FAIL',
      detail: `missing ${missing.join(', ')} — run npm install`,
      required: true,
    };
  }

  return { name: 'Dependencies', status: 'PASS', detail: `${names.length} package(s)`, required: true };
}

function loadConfigSafe(): { config: QaConfig | null; error?: string } {
  if (!fs.existsSync(PATHS.config)) {
    return { config: null, error: `${path.relative(PATHS.root, PATHS.config)} not found` };
  }
  try {
    return { config: loadConfig() };
  } catch (error) {
    return { config: null, error: String(error) };
  }
}

function printInspect(config: QaConfig | null, configError?: string): void {
  logStep('Environment');
  console.log(`OS              ${os.type()} ${os.release()}`);
  console.log(`Platform        ${process.platform}`);
  console.log(`Architecture    ${os.arch()}`);
  console.log(`CWD             ${process.cwd()}`);
  console.log(`Project root    ${PATHS.root}`);
  if (path.resolve(process.cwd()) !== path.resolve(PATHS.root)) {
    console.log('Note            CWD differs from project root');
  }

  logStep('package.json');
  try {
    const pkg = readPackageJson();
    const depCount = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length;
    console.log(`Name            ${pkg.name ?? 'n/a'}`);
    console.log(`Version         ${pkg.version ?? 'n/a'}`);
    console.log(`Dependencies    ${depCount}`);
  } catch (error) {
    console.log(`Status          FAIL — ${String(error)}`);
  }

  logStep('Configuration');
  if (!config) {
    console.log(`qa.config.json  ${configError ?? 'unavailable'}`);
  } else {
    console.log('qa.config.json  present');
    console.log(`Project         ${config.project.name}`);
    console.log(`Website         ${config.urls.website}`);
    console.log(`API             ${config.urls.api}`);
    console.log(`Playwright      ${config.playwright.enabled ? 'enabled' : 'disabled'} (${resolvePlaywrightBrowsers(config.playwright).join(', ')})`);
    console.log(`Postman         ${config.postman.enabled ? 'enabled' : 'disabled'} (${config.postman.requests.length} request(s))`);
    console.log(`JMeter          ${config.jmeter.enabled ? 'enabled' : 'disabled'} (default ${config.jmeter.defaultProfile ?? 'liveness'}; ${config.jmeter.threads} liveness thread(s))`);
  }

  logStep('Environment variables');
  for (const key of INSPECTED_ENV_KEYS) {
    console.log(`${key.padEnd(24)} ${describeEnv(key)}`);
  }

  logStep('Test directories');
  const testDirs = [
    ['tests/e2e', path.join(PATHS.root, 'tests', 'e2e')],
    ['tests/e2e/generated', PATHS.generatedSpecsDir],
    ['tests/api/postman', path.dirname(PATHS.postmanCollection)],
    ['tests/performance', path.dirname(PATHS.jmeterPlan)],
    ['scripts/security', path.join(PATHS.root, 'scripts', 'security')],
    ['scripts/seo', path.join(PATHS.root, 'scripts', 'seo')],
    ['scripts/content', path.join(PATHS.root, 'scripts', 'content')],
    ['scripts/failures', path.join(PATHS.root, 'scripts', 'failures')],
    ['scripts/retest', path.join(PATHS.root, 'scripts', 'retest')],
    ['scripts/coverage', path.join(PATHS.root, 'scripts', 'coverage')],
    ['scripts/reporting', path.join(PATHS.root, 'scripts', 'reporting')],
    ['scripts/orchestrator', path.join(PATHS.root, 'scripts', 'orchestrator')],
    ['fixtures/site', PATHS.fixturesSiteDir],
  ];
  for (const [label, dir] of testDirs) {
    console.log(`${label.padEnd(24)} ${fs.existsSync(dir) ? 'present' : 'missing'}`);
  }

  logStep('Git repository');
  const git = findOnPath('git');
  if (!git) {
    console.log('Repository      Git not available');
    return;
  }

  const inside = captureCommand(git, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || firstLine(inside.stdout) !== 'true') {
    console.log('Repository      no');
    return;
  }

  const branch = firstLine(captureCommand(git, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout) || 'unknown';
  const porcelain = captureCommand(git, ['status', '--porcelain']);
  const rows = porcelain.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const visible = rows.filter((line) => !SECRET_PATH.test(line));
  const hidden = rows.length - visible.length;

  console.log('Repository      yes');
  console.log(`Branch          ${branch}`);
  if (rows.length === 0) {
    console.log('Status          clean');
  } else {
    const hiddenNote = hidden > 0 ? `, ${hidden} secret-path(s) hidden` : '';
    console.log(`Status          ${rows.length} uncommitted change(s)${hiddenNote}`);
  }
}

function printChecks(checks: CheckResult[]): void {
  logStep('Tool checks');
  const nameWidth = Math.max(...checks.map((check) => check.name.length));
  const statusWidth = 7;

  for (const check of checks) {
    const name = check.name.padEnd(nameWidth);
    const status = check.status.padEnd(statusWidth);
    console.log(`${name}  ${status}  ${check.detail}`);
  }

  const passed = checks.filter((check) => check.status === 'PASS').length;
  const warned = checks.filter((check) => check.status === 'WARNING').length;
  const failed = checks.filter((check) => check.status === 'FAIL').length;
  console.log('');
  console.log(`Summary         ${passed} PASS, ${warned} WARNING, ${failed} FAIL`);
}

function writeReport(checks: CheckResult[]): void {
  fs.mkdirSync(PATHS.reports.root, { recursive: true });
  const reportPath = path.join(PATHS.reports.root, 'preflight.json');
  const payload = {
    ranAt: new Date().toISOString(),
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    arch: os.arch(),
    cwd: process.cwd(),
    root: PATHS.root,
    checks: checks.map(({ name, status, detail, required }) => ({ name, status, detail, required })),
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Report          ${path.relative(PATHS.root, reportPath)}`);
}

function main(): void {
  const { config, error } = loadConfigSafe();
  printInspect(config, error);

  const checks: CheckResult[] = [
    checkNode(),
    checkNpm(),
    checkGit(),
    checkJava(),
    checkJmeter(config),
    checkPostman(config),
    checkPlaywright(),
    checkPlaywrightSuitePaths(),
    checkBrowsers(config),
    checkTypeScript(),
    checkDependencies(),
  ];

  if (error) {
    checks.unshift({
      name: 'qa.config.json',
      status: 'FAIL',
      detail: error,
      required: true,
    });
  }

  printChecks(checks);
  writeReport(checks);

  const failedRequired = checks.filter((check) => check.status === 'FAIL' && check.required);
  if (failedRequired.length > 0) {
    process.exit(1);
  }
}

main();
