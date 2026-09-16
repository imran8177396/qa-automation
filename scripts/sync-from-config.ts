import {
  generateEnvFile,
  generateGithubWorkflow,
  generateJenkinsfiles,
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
    logSuccess(
      'Generated JMeter plans at tests/performance/jmeter/{smoke,load,stress,spike,soak}/documented-api.jmx and tests/performance/load-test.jmx (liveness alias)'
    );
  }

  generateGithubWorkflow(config);
  logSuccess('Generated .github/workflows/qa-automation.yml');
  logSuccess('Generated .github/workflows/qa-regression.yml');
  logSuccess('Generated .github/workflows/qa-performance-heavy.yml');

  generateJenkinsfiles(config);
  logSuccess('Generated jenkins/Jenkinsfile');
  logSuccess('Generated jenkins/Jenkinsfile.regression');
  logSuccess('Generated jenkins/Jenkinsfile.performance');
}

if (require.main === module) {
  runSync().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
