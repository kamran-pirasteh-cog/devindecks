/**
 * Waterfall row kinds, with the wording the datasheet and the Devin prompt both
 * use. Defined once so a dropdown option and a prompt's explanation of that
 * option can never drift apart.
 */
import type { WaterfallRole } from './spec';

export const WATERFALL_ROLE_OPTIONS: { value: WaterfallRole; label: string; hint: string }[] = [
  {
    value: 'start',
    label: 'Start',
    hint: 'The opening level the bridge starts from, as an absolute figure.',
  },
  {
    value: 'delta',
    label: 'Change',
    hint: 'A movement up or down. Negative values decrease the running total.',
  },
  {
    value: 'subtotal',
    label: 'Subtotal',
    hint: 'A running total to date. Leave the value blank to compute it.',
  },
  {
    value: 'total',
    label: 'Total',
    hint: 'The closing level. Leave the value blank to compute it.',
  },
  {
    value: 'spacer',
    label: 'Spacer',
    hint: 'A gap in the sequence; draws nothing.',
  },
];

export const waterfallRoleLabel = (role: WaterfallRole): string =>
  WATERFALL_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role;
