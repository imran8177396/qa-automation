export function getEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export function getCredentials() {
  return {
    username: getEnv('QA_USERNAME'),
    password: getEnv('QA_PASSWORD'),
  };
}
