import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import { loadConfig } from './lib/load-config';
import { PATHS } from './lib/paths';
import { logStep, logSuccess, logWarn, logError } from './lib/logger';
import { resolveDiscoveryConfig } from './core/scope';
import { resolveSafetyConfig } from './core/safety-policy';
import { crawl } from './discovery/crawler';
import { inventoryPage } from './inventory/element-inventory';
import { classifyElements } from './inventory/classify-elements';
import { generateChecks } from './planning/generate-checks';
import { analyzeSeo, isSeoSkippedPage } from './seo/analyze-seo';
import { runE2eAndGeneratedCheck, runPlaywright } from './runners/playwright';
import { runPostman } from './runners/postman';
import { runJmeter } from './runners/jmeter';
import { runLighthouse } from './lighthouse/run';
import type { DiscoveryResult } from './discovery/types';
import type { InventoryResult } from './inventory/types';
import type { SafetyConfigResolved } from './core/safety-policy';
import { writeProfessionalSqaReport } from './reporting/write-enterprise-report';
import { cleanRunArtifacts, shouldKeepArtifacts } from './lib/clean-run-artifacts';

interface CliArgs {
  url: string;
  maxPages?: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const url = args.find((arg) => !arg.startsWith('--'));
  if (!url) {
    throw new Error('Usage: npm run qa:test -- <url> [--max-pages=N]');
  }
  const maxPagesArg = args.find((arg) => arg.startsWith('--max-pages='));
  return {
    url,
    maxPages: maxPagesArg ? Number(maxPagesArg.split('=')[1]) : undefined,
  };
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

async function inventorySite(
  discovery: DiscoveryResult,
  safety: SafetyConfigResolved
): Promise<InventoryResult> {
  const browser = await chromium.launch();
  const elements: InventoryResult['elements'] = [];
  try {
    for (const page of discovery.pages) {
      if (page.error || page.status === null || page.status >= 400) continue;

      const browserPage = await browser.newPage();
      try {
        await browserPage.goto(page.url, { waitUntil: 'load', timeout: 30000 });
        const pageElements = await inventoryPage(browserPage, page.url);
        elements.push(...classifyElements(pageElements, safety));
      } catch (error) {
        logWarn(`Inventory skipped for ${page.url}: ${String(error)}`);
      } finally {
        await browserPage.close();
      }
    }
  } finally {
    await browser.close();
  }

  return { generatedAt: new Date().toISOString(), pages: discovery.pages.length, elements };
}

async function main(): Promise<void> {
  const { url, maxPages } = parseArgs();
  const config = loadConfig();

  const safety = resolveSafetyConfig(config.safety);
  const discoveryOptions = resolveDiscoveryConfig({ ...config.discovery, maxPages: maxPages ?? config.discovery?.maxPages });

  logStep(`${config.project.name} — Discovery-driven QA test: ${url}`);
  if (shouldKeepArtifacts()) {
    logWarn('Keeping previous run artifacts (--keep-artifacts)');
  } else {
    logStep('Cleaning previous test artifacts and cache');
    const { removed } = cleanRunArtifacts();
    logSuccess(
      removed.length === 0
        ? 'No previous run artifacts were present'
        : `Removed ${removed.length} previous artifact path(s)`
    );
  }
  fs.mkdirSync(PATHS.reports.discovery, { recursive: true });

  logStep('Crawling site');
  const discovery = await crawl(url, { ...discoveryOptions, safety });
  fs.writeFileSync(PATHS.discoveryFile, `${JSON.stringify(discovery, null, 2)}\n`, 'utf8');
  logSuccess(
    `Discovered ${discovery.pages.length} page(s) from ${discovery.seedUrl} (truncated: ${discovery.truncated})`
  );

  logStep('Inventorying interactive elements');
  const inventory = await inventorySite(discovery, safety);
  fs.writeFileSync(PATHS.inventoryFile, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  logSuccess(`Inventoried ${inventory.elements.length} element(s) across ${inventory.pages} page(s)`);

  logStep('Planning checks');
  const plannedChecks = generateChecks(discovery, inventory);
  fs.mkdirSync(path.dirname(PATHS.plannedChecksFile), { recursive: true });
  fs.writeFileSync(PATHS.plannedChecksFile, `${JSON.stringify(plannedChecks, null, 2)}\n`, 'utf8');
  const gated = plannedChecks.filter((check) => check.status !== 'PLANNED').length;
  logSuccess(
    `Planned ${plannedChecks.length} check(s) — ${plannedChecks.length - gated} runnable, ${gated} blocked/not-tested/requires-configuration`
  );

  logStep('Analyzing SEO');
  const seoFindings = analyzeSeo(discovery);
  const seoResult = {
    analyzedAt: new Date().toISOString(),
    pagesAnalyzed: discovery.pages.filter((page) => !isSeoSkippedPage(page)).length,
    findings: seoFindings,
  };
  fs.writeFileSync(PATHS.seoFile, `${JSON.stringify(seoResult, null, 2)}\n`, 'utf8');
  const seoHighSeverity = seoFindings.filter((f) => f.severity === 'high').length;
  logSuccess(`Found ${seoFindings.length} SEO finding(s) (${seoHighSeverity} high severity)`);

  const originMatches = sameHost(discovery.seedUrl, config.urls.website);

  logStep('Running discovery-generated checks (Playwright)');
  const playwrightPassed = originMatches
    ? await runE2eAndGeneratedCheck(config)
    : await runPlaywright(config, { suiteName: 'generated-check', grep: '@generated' });

  let postmanPassed = true;
  let jmeterPassed = true;
  let lighthousePassed = true;

  if (originMatches) {
    logStep('Origin matches qa.config.json — running configured API/performance suites too');
    postmanPassed = await runPostman(config);
    jmeterPassed = await runJmeter(config);
    lighthousePassed = await runLighthouse(config);
  } else {
    logWarn(
      `Skipping Postman/JMeter and hand-written tests/e2e specs — crawled host (${new URL(discovery.seedUrl).host}) ` +
        `does not match qa.config.json's configured site (${new URL(config.urls.website).host}). ` +
        'Only tests/e2e/generated/ ran, against the crawled URL. Point qa.config.json at this site to enable full coverage.'
    );
  }

  const results = [
    { name: 'Discovery E2E', tool: 'Playwright', passed: playwrightPassed, report: PATHS.reports.playwright },
    { name: 'API', tool: 'Postman CLI', passed: postmanPassed, report: path.join(PATHS.reports.postman, 'report.json') },
    { name: 'Performance', tool: 'JMeter', passed: jmeterPassed, report: path.join(PATHS.reports.jmeter, 'html') },
    { name: 'Core Web Vitals', tool: 'Lighthouse', passed: lighthousePassed, report: PATHS.lighthouseSummary },
  ];

  fs.mkdirSync(PATHS.reports.root, { recursive: true });
  const summaryPath = path.join(PATHS.reports.root, 'summary.json');
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)}\n`,
    'utf8'
  );
  logSuccess(`Combined summary saved to ${summaryPath}`);

  if (config.report?.enabled !== false && config.report?.autoGenerateAfterTests !== false) {
    await writeProfessionalSqaReport();
  } else {
    logWarn('Professional SQA report skipped (disabled in qa.config.json report settings).');
  }

  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0) {
    logError(`${failed.length} tool(s) failed: ${failed.map((r) => r.tool).join(', ')}`);
    process.exit(1);
  }

  logSuccess('Discovery-driven QA test finished');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
