import { loadConfig } from './lib/load-config';
import { runPostman } from './runners/postman';

runPostman(loadConfig())
  .then((passed) => process.exit(passed ? 0 : 1))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
