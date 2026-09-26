/**
 * Backward-compatible re-export of the shared fuzz catalog.
 * Prefer importing from `scripts/testing/fuzz` (stable path for API/UI/form/database/security).
 * Input generation only — does not send HTTP or touch a target.
 */

export {
  generateFuzzInputs,
  FUZZ_VERY_LONG_LENGTH,
  type FuzzInput,
  type FuzzTarget,
} from '../fuzz/generate';
