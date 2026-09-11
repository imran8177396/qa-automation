import type { Page } from '@playwright/test';
import { LANDMARK_SELECTORS } from './pages';
import type { Box } from './geometry';

export interface LandmarkBox {
  name: string;
  selector: string;
  present: boolean;
  visible: boolean;
  box: Box | null;
  scrollWidth: number;
  clientWidth: number;
  overflowX: string;
}

export interface MediaBox {
  name: string;
  naturalWidth: number;
  box: Box;
}

export interface LayoutSnapshot {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  clientWidth: number;
  bodyFontSize: number;
  landmarks: LandmarkBox[];
  siblingGroups: Record<string, Box[]>;
  images: MediaBox[];
  buttons: Array<{ name: string; box: Box }>;
}

export async function collectLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate((selectors) => {
    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };

    const first = (selector: string): Element | null => document.querySelector(selector);

    const landmarks = Object.entries(selectors).map(([name, selector]) => {
      const el = first(selector);
      if (!el) {
        return {
          name,
          selector,
          present: false,
          visible: false,
          box: null,
          scrollWidth: 0,
          clientWidth: 0,
          overflowX: '',
        };
      }
      const style = window.getComputedStyle(el);
      const htmlEl = el as HTMLElement;
      return {
        name,
        selector,
        present: true,
        visible: style.display !== 'none' && style.visibility !== 'hidden',
        box: boxOf(el),
        scrollWidth: htmlEl.scrollWidth,
        clientWidth: htmlEl.clientWidth,
        overflowX: style.overflowX,
      };
    });

    const siblingGroups: Record<string, Box[]> = {
      cards: [...document.querySelectorAll('.card')].map(boxOf),
      grid: [...document.querySelectorAll('.feature')].map(boxOf),
    };

    const images = [...document.querySelectorAll('img')].map((img) => ({
      name: img.getAttribute('alt') || img.getAttribute('src') || 'img',
      naturalWidth: img.naturalWidth,
      box: boxOf(img),
    }));

    const buttons = [...document.querySelectorAll('button, [role="button"]')].map((btn) => ({
      name: (btn.textContent || '').trim() || btn.id || 'button',
      box: boxOf(btn),
    }));

    const bodySize = Number.parseFloat(window.getComputedStyle(document.body).fontSize);

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyFontSize: bodySize,
      landmarks,
      siblingGroups,
      images,
      buttons,
    };
  }, LANDMARK_SELECTORS);
}
