import { mapPerformanceProfileAlias } from './profiles';

export interface PerformanceCli {
  /** Requested profile token (defaults to liveness). Aliases are normalized when they map to a plan. */
  profile: string;
  /** Exact CLI/env token before alias normalization. */
  rawProfile: string;
  authorizeHeavy: boolean;
}

export function resolvePerformanceCli(argv: string[] = process.argv.slice(2)): PerformanceCli {
  const profileArg = argv.find((arg) => arg.startsWith('--profile='));
  const raw = (profileArg?.split('=')[1] ?? process.env.QA_JMETER_PROFILE ?? 'liveness').trim() || 'liveness';
  const authorizeHeavy =
    argv.includes('--authorize-heavy') ||
    process.env.QA_PERF_AUTHORIZE === 'true' ||
    process.env.QA_PERF_AUTHORIZE === '1';

  const mapped = mapPerformanceProfileAlias(raw);
  return {
    profile: mapped.mapped ? mapped.id : raw,
    rawProfile: raw,
    authorizeHeavy,
  };
}
