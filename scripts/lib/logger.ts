export function logStep(title: string): void {
  console.log(`\n=== ${title} ===`);
}

export function logSuccess(message: string): void {
  console.log(`✓ ${message}`);
}

export function logWarn(message: string): void {
  console.warn(`! ${message}`);
}

export function logError(message: string): void {
  console.error(`✗ ${message}`);
}
