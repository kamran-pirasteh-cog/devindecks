/**
 * Waterfall row kinds, with the wording the datasheet and the Devin prompt both
 * use. Defined once so a dropdown option and a prompt's explanation of that
 * option can never drift apart.
 */
import type { GanttItemShape, WaterfallRole } from './spec';

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

/**
 * Gantt item shapes, with the wording the datasheet and the Devin prompt both
 * use — the same contract `WATERFALL_ROLE_OPTIONS` keeps.
 *
 * The value is the shape's `form`, so a dropdown selection is one field read
 * rather than a mapping table that can drift from the union.
 */
export type GanttItemForm = GanttItemShape['form'];

export const GANTT_ITEM_FORM_OPTIONS: {
  value: GanttItemForm;
  label: string;
  hint: string;
}[] = [
  {
    value: 'bar',
    label: 'Bar',
    hint: 'A task running from Start to End. The default.',
  },
  {
    value: 'chevron',
    label: 'Chevron',
    hint: 'A process arrow, for a phase that leads into the next one.',
  },
  {
    value: 'milestone',
    label: 'Milestone',
    hint: 'A point in time — a launch, a sign-off. End is ignored.',
  },
  {
    value: 'summary',
    label: 'Summary',
    hint: 'A roll-up over the rows beneath. Leave the dates blank to compute them.',
  },
  {
    value: 'bracket',
    label: 'Bracket',
    hint: 'A brace spanning a period, drawn clear of the bars.',
  },
];

export const ganttItemFormLabel = (form: GanttItemForm): string =>
  GANTT_ITEM_FORM_OPTIONS.find((o) => o.value === form)?.label ?? form;
