export const VIEWPORT_NAMES = ['desktop', 'laptop', 'tablet', 'mobile'] as const;

export type ViewportName = (typeof VIEWPORT_NAMES)[number];

/**
 * Playwright viewport/touch emulation profiles.
 *
 * These are layout viewports, not real devices. A passing mobile-sized Chromium
 * (or WebKit) run is not iPhone coverage and is not Mobile Safari coverage.
 */
export interface ViewportProfile {
  name: ViewportName;
  width: number;
  height: number;
  isMobile: boolean;
  hasTouch: boolean;
  /** True when a compact nav/menu pattern is the expected chrome. */
  compactChrome: boolean;
  projectName: string;
  emulationNote: string;
}

export const EMULATION_NOTE =
  'Chromium emulated viewport (page.setViewportSize / Playwright viewport + touch flags) — not a real device, not iOS Safari, not Android Chrome';

export const VIEWPORTS: Record<ViewportName, ViewportProfile> = {
  desktop: {
    name: 'desktop',
    width: 1920,
    height: 1080,
    isMobile: false,
    hasTouch: false,
    compactChrome: false,
    projectName: 'responsive-desktop',
    emulationNote: EMULATION_NOTE,
  },
  laptop: {
    name: 'laptop',
    width: 1366,
    height: 768,
    isMobile: false,
    hasTouch: false,
    compactChrome: false,
    projectName: 'responsive-laptop',
    emulationNote: EMULATION_NOTE,
  },
  tablet: {
    name: 'tablet',
    width: 768,
    height: 1024,
    isMobile: true,
    hasTouch: true,
    compactChrome: true,
    projectName: 'responsive-tablet',
    emulationNote: EMULATION_NOTE,
  },
  mobile: {
    name: 'mobile',
    width: 390,
    height: 844,
    isMobile: true,
    hasTouch: true,
    compactChrome: true,
    projectName: 'responsive-mobile',
    emulationNote: EMULATION_NOTE,
  },
};

export function viewportFromProjectName(projectName: string | undefined): ViewportProfile {
  const match = VIEWPORT_NAMES.find((name) => VIEWPORTS[name].projectName === projectName);
  if (!match) {
    throw new Error(
      `Unknown responsive project "${projectName ?? ''}". Expected one of: ${VIEWPORT_NAMES.map((n) => VIEWPORTS[n].projectName).join(', ')}`
    );
  }
  return VIEWPORTS[match];
}

export function playwrightUseFor(profile: ViewportProfile): {
  viewport: { width: number; height: number };
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
} {
  return {
    viewport: { width: profile.width, height: profile.height },
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    deviceScaleFactor: 1,
  };
}

export const RESPONSIVE_LIMITATIONS = [
  'This suite uses emulated viewports in Chromium (page.setViewportSize and Playwright project viewport/touch flags). It is not a real device.',
  'No real iOS Safari, real Android Chrome, or device-cloud session was executed.',
  'A passing mobile emulated viewport is not iPhone coverage and is not Mobile Safari coverage.',
  'Playwright device descriptors are not used as named iPhone/Pixel profiles — form factors are desktop/laptop/tablet/mobile only.',
  'WebKit engine results (if added later) would still be browser-engine testing, not Mobile Safari on a device.',
] as const;
