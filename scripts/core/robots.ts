export interface RobotsRules {
  disallow: string[];
  allow: string[];
}

/**
 * Best-effort robots.txt awareness for crawl politeness/scope — NOT a safety control. A page can be
 * fully crawlable per robots.txt and still contain a destructive action; see safety-policy.ts for that.
 */
export async function fetchRobotsRules(origin: string, userAgent = '*'): Promise<RobotsRules> {
  const rules: RobotsRules = { disallow: [], allow: [] };

  try {
    const response = await fetch(new URL('/robots.txt', origin).toString());
    if (!response.ok) return rules;

    const body = await response.text();
    let groupApplies = false;

    for (const rawLine of body.split('\n')) {
      const line = rawLine.split('#')[0].trim();
      if (!line) continue;

      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) continue;

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();

      if (key === 'user-agent') {
        groupApplies = value === '*' || value.toLowerCase() === userAgent.toLowerCase();
        continue;
      }
      if (!groupApplies) continue;

      if (key === 'disallow' && value) rules.disallow.push(value);
      if (key === 'allow' && value) rules.allow.push(value);
    }
  } catch {
    // robots.txt unreachable — treat as unrestricted; this is a politeness signal, not a safety gate.
  }

  return rules;
}

export function isAllowedByRobots(pathname: string, rules: RobotsRules): boolean {
  const matchLength = (rule: string) => (pathname.startsWith(rule) ? rule.length : -1);

  const bestAllow = Math.max(-1, ...rules.allow.map(matchLength));
  const bestDisallow = Math.max(-1, ...rules.disallow.map(matchLength));

  if (bestDisallow === -1) return true;
  return bestAllow >= bestDisallow;
}
