import { describe, expect, it } from 'vitest';
import { defaultChartSpec } from './defaults';
import {
  addGanttColumn,
  columnsOnSide,
  moveGanttColumn,
  nudgeGanttColumn,
  removeGanttColumn,
} from './ganttColumns';
import { isGanttSpec, type GanttSpec } from './spec';

const gantt = (): GanttSpec => {
  const s = defaultChartSpec('gantt');
  if (!isGanttSpec(s)) throw new Error('not a gantt');
  // The sample carries two columns, both on the left. These operations are all
  // about the two SIDES, so the fixture puts something on each.
  s.columns.push({
    key: 'col.end',
    header: 'Due',
    side: 'right',
    order: 0,
    source: 'end',
    dateFormat: 'd MMM',
  });
  return s;
};

/** The table as a reader sees it: left to right, plot in the middle. */
const reading = (s: GanttSpec): string[] => [
  ...columnsOnSide(s, 'left').map((c) => c.header),
  '▮CHART▮',
  ...columnsOnSide(s, 'right').map((c) => c.header),
];

describe('the sample', () => {
  it('reads left to right with the chart between the sides', () => {
    expect(reading(gantt())).toEqual(['Workstream', 'Owner', '▮CHART▮', 'Due']);
  });
});

describe('crossing the chart body', () => {
  it('lands outermost on the side it arrives at', () => {
    const s = gantt();
    expect(moveGanttColumn(s, 'col.owner', 'right')).toBe(true);
    // Past everything already there, which is where a drag would have put it.
    expect(reading(s)).toEqual(['Workstream', '▮CHART▮', 'Due', 'Owner']);
  });

  it('and back again, still outermost', () => {
    const s = gantt();
    moveGanttColumn(s, 'col.owner', 'right');
    moveGanttColumn(s, 'col.owner', 'left');
    expect(reading(s)).toEqual(['Workstream', 'Owner', '▮CHART▮', 'Due']);
  });

  it('does nothing when it is already there', () => {
    const s = gantt();
    expect(moveGanttColumn(s, 'col.owner', 'left')).toBe(false);
  });

  it('does nothing for a column that does not exist', () => {
    expect(moveGanttColumn(gantt(), 'nope', 'right')).toBe(false);
  });
});

describe('nudging within a side', () => {
  it('moves toward the chart on the LEFT', () => {
    const s = gantt();
    expect(nudgeGanttColumn(s, 'col.task', -1)).toBe(true);
    expect(reading(s)).toEqual(['Owner', 'Workstream', '▮CHART▮', 'Due']);
  });

  it('moves toward the chart on the RIGHT too, though order runs the other way', () => {
    // The reason `delta` is stated in reading terms: both sides lay out
    // left-to-right by ascending order, so "toward the chart" is a higher order
    // on the left and a lower one on the right. The arrow the user presses has
    // to mean the same thing on both sides of the plot.
    const s = gantt();
    addGanttColumn(s, { side: 'right', header: 'Status' });
    expect(reading(s)).toEqual(['Workstream', 'Owner', '▮CHART▮', 'Due', 'Status']);
    expect(nudgeGanttColumn(s, 'col.c1', -1)).toBe(true);
    expect(reading(s)).toEqual(['Workstream', 'Owner', '▮CHART▮', 'Status', 'Due']);
  });

  it('stops at the end of the run rather than wrapping', () => {
    const s = gantt();
    // A column that jumped to the far end because the arrow was pressed once
    // too often cannot be undone by pressing it again.
    expect(nudgeGanttColumn(s, 'col.task', 1)).toBe(false);
    expect(nudgeGanttColumn(s, 'col.owner', -1)).toBe(false);
    expect(reading(s)).toEqual(['Workstream', 'Owner', '▮CHART▮', 'Due']);
  });
});

describe('adding', () => {
  it('inserts immediately after the column it was asked for', () => {
    const s = gantt();
    addGanttColumn(s, { after: 'col.task', header: 'Team' });
    expect(reading(s)).toEqual(['Workstream', 'Team', 'Owner', '▮CHART▮', 'Due']);
  });

  it('appends to the outer end when no anchor is named', () => {
    const s = gantt();
    addGanttColumn(s, { side: 'left', header: 'Team' });
    expect(reading(s)).toEqual(['Workstream', 'Owner', 'Team', '▮CHART▮', 'Due']);
  });

  it('is authored text by default — a derived source is a separate decision', () => {
    expect(addGanttColumn(gantt()).source).toBe('text');
  });

  it('mints a key nothing already uses, however many are added', () => {
    const s = gantt();
    const keys = [addGanttColumn(s).key, addGanttColumn(s).key, addGanttColumn(s).key];
    expect(new Set(keys).size).toBe(3);
    expect(new Set(s.columns.map((c) => c.key)).size).toBe(s.columns.length);
  });
});

describe('removing', () => {
  it('takes the authored cells with it', () => {
    const s = gantt();
    expect(s.cells?.r0?.['col.owner']).toBe('AM');
    expect(removeGanttColumn(s, 'col.owner')).toBe(true);
    // Left behind, they would grow the spec by a copy of the table every time
    // a column was added and dropped again.
    expect(s.cells?.r0?.['col.owner']).toBeUndefined();
    expect(s.columns.some((c) => c.key === 'col.owner')).toBe(false);
  });

  it('leaves the other columns and their cells alone', () => {
    const s = gantt();
    addGanttColumn(s, { header: 'Team', key: 'col.team' });
    s.cells!.r0!['col.team'] = 'Core';
    removeGanttColumn(s, 'col.owner');
    expect(s.cells?.r0?.['col.team']).toBe('Core');
  });

  it('drops a row entry that held nothing else', () => {
    const s = gantt();
    removeGanttColumn(s, 'col.owner');
    expect(s.cells?.r0).toBeUndefined();
  });

  it('reports false for a column that was not there', () => {
    expect(removeGanttColumn(gantt(), 'nope')).toBe(false);
  });
});
