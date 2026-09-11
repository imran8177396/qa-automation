import { normalizePerformanceProfile } from './profiles';
import type { CanonicalPerformanceProfile, PerformanceProfile } from './types';

export interface PerformanceCli {
  profile: CanonicalPerformanceProfile;
  rawProfile: PerformanceProfile;
  authorizeHeavy: boolean;
}

export function resolvePerformanceCli(argv: string[] = process.argv.slice(2)): PerformanceCli {
  const profileArg = argv.find((arg) => arg.startsWith('--profile='));
  const raw = (profileArg?.split('=')[1] ?? process.env.QA_JMETER_PROFILE ?? 'liveness') as PerformanceProfile;
  const authorizeHeavy =
    argv.includes('--authorize-heavy') ||
    process.env.QA_PERF_AUTHORIZE === 'true' ||
    process.env.QA_PERF_AUTHORIZE === '1';

  return { profile: normalizePerformanceProfile(raw), rawProfile: raw, authorizeHeavy };
}
