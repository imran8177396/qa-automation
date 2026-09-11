export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const LAYOUT_SLACK_PX = 2;

export function boxesOverlap(a: Box, b: Box, slack = LAYOUT_SLACK_PX): boolean {
  return (
    a.x + a.width > b.x + slack &&
    b.x + b.width > a.x + slack &&
    a.y + a.height > b.y + slack &&
    b.y + b.height > a.y + slack
  );
}

export function boxOverflowsViewport(box: Box, viewportWidth: number, slack = LAYOUT_SLACK_PX): boolean {
  return box.x + box.width > viewportWidth + slack || box.x < -slack;
}

export function documentHasHorizontalOverflow(
  scrollWidth: number,
  clientWidth: number,
  slack = LAYOUT_SLACK_PX
): boolean {
  return scrollWidth > clientWidth + slack;
}

export function isCollapsed(box: Box): boolean {
  return box.width < 1 || box.height < 1;
}

export function clipAmount(scrollWidth: number, clientWidth: number, slack = LAYOUT_SLACK_PX): number {
  return Math.max(0, scrollWidth - clientWidth - slack);
}
