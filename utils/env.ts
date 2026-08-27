export function getEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

export function isPlaceholderUrl(url: string): boolean {
  return url.includes('your-website.com') || url.includes('your-api.com');
}

export function getCredentials() {
  return {
    username: getEnv('QA_USERNAME', 'test@example.com'),
    password: getEnv('QA_PASSWORD', 'Password123'),
  };
}
