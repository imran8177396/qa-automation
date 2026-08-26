import path from 'path';

export const ROOT = path.resolve(__dirname, '../..');

export const PATHS = {
  root: ROOT,
  config: path.join(ROOT, 'qa.config.json'),
  generatedEnv: path.join(ROOT, 'config', 'generated.env'),
  postmanCollection: path.join(ROOT, 'tests', 'api', 'postman', 'collection.json'),
  postmanEnvironment: path.join(ROOT, 'tests', 'api', 'postman', 'environment.json'),
  postmanExport: path.join(ROOT, 'postman', 'QA-Automation-API.postman_collection.json'),
  jmeterPlan: path.join(ROOT, 'tests', 'performance', 'load-test.jmx'),
  reports: {
    root: path.join(ROOT, 'reports'),
    postman: path.join(ROOT, 'reports', 'postman'),
    jmeter: path.join(ROOT, 'reports', 'jmeter'),
    playwright: path.join(ROOT, 'reports', 'playwright'),
  },
};
