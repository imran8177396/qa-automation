import {
  generateEnvFile,
  generateGithubWorkflow,
  generateJmeterPlan,
  generatePostmanFiles,
  generateReportsFolders,
} from './generators/index';
import { loadConfig } from './lib/load-config';
import { logStep, logSuccess } from './lib/logger';

export async function runSync(): Promise<void> {
  logStep('Sync from qa.config.json');
  const config = loadConfig();

  generateEnvFile(config);
  logSuccess('Generated config/generated.env');

  generateReportsFolders();
  logSuccess('Created reports/ folders');

  if (config.postman.enabled) {
    generatePostmanFiles(config);
    logSuccess('Exported Postman collection to tests/api/postman/collections/qa-automation-api.json');
  }

  if (config.jmeter.enabled) {
    generateJmeterPlan(config);
    logSuccess('Generated JMeter test plan at tests/performance/load-test.jmx');
  }

  generateGithubWorkflow(config);
  logSuccess('Generated .github/workflows/qa-automation.yml');
  logSuccess('Generated .github/workflows/qa-performance-heavy.yml');
}

if (require.main === module) {
  runSync().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
