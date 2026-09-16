import type { Request, Response } from '@playwright/test';

export interface RedirectHop {
  from: string;
  to: string;
  status: number | null;
}

/**
 * Reconstruct the redirect chain Playwright already followed.
 * Does not invent hops — empty when the final URL matches the first request.
 */
export async function redirectChain(response: Response | null, finalUrl: string): Promise<RedirectHop[]> {
  if (!response) return [];

  const requests: Request[] = [];
  let current: Request | null = response.request();
  while (current) {
    requests.unshift(current);
    current = current.redirectedFrom();
  }

  const hops: RedirectHop[] = [];
  for (let i = 0; i < requests.length; i += 1) {
    const req = requests[i];
    const next = requests[i + 1];
    const to = next ? next.url() : finalUrl;
    if (req.url() === to) continue;
    const hopResponse = await req.response();
    hops.push({
      from: req.url(),
      to,
      status: hopResponse?.status() ?? null,
    });
  }
  return hops;
}
