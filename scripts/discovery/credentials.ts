import { getCredentials } from '../../utils/env';

export interface DiscoveryCredentials {
  username: string;
  password: string;
}

/** Env-only. Never read credentials from qa.config.json. */
export function discoveryCredentials(): DiscoveryCredentials | null {
  const { username, password } = getCredentials();
  const user = username.trim();
  const pass = password.trim();
  if (!user || !pass) return null;
  return { username: user, password: pass };
}
