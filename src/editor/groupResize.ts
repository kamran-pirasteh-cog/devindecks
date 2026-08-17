/**
 * The scale factor one axis of a group resize takes.
 *
 * Split out of `EditorCanvas` because the rule it encodes is not obvious and
 * is worth a test: the factor is measured against the group's start bounds as
 * the MODEL knows them, not against the box Moveable measures.
 *
 * Moveable reports a group height of 0 whenever the selection contains a chart
 * — a chart contributes zero-height nodes (gridlines, axis rules) and its group
 * box comes back degenerate on that axis — and a naive `live / (live - dist)`
 * turns that into a scale factor of 0. A chart grouped with one other object
 * then collapsed to a flat strip the moment a handle moved, permanently.
 *
 * So: trust the live measurement while it is positive, fall back to the delta
 * (the one number Moveable always gets right), and hold the axis still if
 * neither is usable. A resize that does nothing on one axis is recoverable; a
 * resize that flattens the selection is not.
 */
export function resizeFactor(startSize: number, live: number, dist: number): number {
  if (!(startSize > 0)) return 1;
  const next = live > 0 ? live : startSize + dist;
  return next > 0 ? next / startSize : 1;
}
