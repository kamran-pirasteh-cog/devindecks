import type { ColorRef } from '@/model';

export { CustomColorSwatch } from './CustomColorSwatch';
export { CustomColorPanel } from './CustomColorPanel';
export * from './colorSpace';

/**
 * The hex a ref is pinned to, or undefined when it follows a brand token. Every
 * colour surface needs exactly this to decide whether its custom swatch is the
 * one in force, and what colour to seed the panel with.
 */
export const customHexOf = (ref: ColorRef | undefined): string | undefined =>
  ref?.kind === 'hex' ? ref.hex : undefined;
