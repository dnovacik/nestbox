import { createNestboxClient } from '@shared/client';

/** Typed client over window.nestbox. Resolved lazily so tests can install a mock bridge first. */
export const api = createNestboxClient(() => window.nestbox);
