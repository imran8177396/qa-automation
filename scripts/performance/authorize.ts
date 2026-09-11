import { isLivenessProfile } from './profiles';
import type { PerformanceProfile } from './types';

export interface PerformanceGateInput {
  profile: PerformanceProfile;
  apiUrl: string;
  authorizeHeavy: boolean;
  allowHeavyAgainst: string[];
}

export function isHeavyAuthorized(profile: PerformanceProfile, options: { authorizeHeavy: boolean }): boolean {
  if (isLivenessProfile(profile)) return true;
  return options.authorizeHeavy;
}

export function gatePerformanceRun(input: PerformanceGateInput): { ok: boolean; code?: string; message: string } {
  if (isLivenessProfile(input.profile)) {
    return { ok: true, message: 'Liveness profile authorized by default. Status is RECORDED, never PASS.' };
  }

  if (!input.authorizeHeavy) {
    return {
      ok: false,
      code: 'NOT_AUTHORIZED',
      message: `Heavy profile "${input.profile}" requires --authorize-heavy or QA_PERF_AUTHORIZE.`,
    };
  }

  let host = '';
  try {
    host = new URL(input.apiUrl).host;
  } catch {
    host = input.apiUrl;
  }

  if (input.allowHeavyAgainst.length > 0 && !input.allowHeavyAgainst.some((entry) => host.includes(entry))) {
    return {
      ok: false,
      code: 'TARGET_NOT_ALLOWED',
      message: `Heavy profile "${input.profile}" is not allowed against ${host}.`,
    };
  }

  return { ok: true, message: `Heavy profile "${input.profile}" authorized.` };
}
