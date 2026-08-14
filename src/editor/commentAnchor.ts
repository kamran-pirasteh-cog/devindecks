/**
 * What a comment thread says it's attached to.
 *
 * A reader scanning the rail is looking at the slide, so the anchor has to name
 * the thing the way they see it — its words. Shape names are the last resort
 * and a poor one: a PPTX import carries the writer's shape tree ("TextBox 4",
 * "Google Shape;12;p3"), which names the container, never the content.
 */
import type { ElementType, SlideElement } from '@/model';

/** Everything an element says, flattened to one line. Empty when it says nothing. */
export function elementText(el: SlideElement): string {
  const body = el.type === 'text' || el.type === 'shape' ? el.body : undefined;
  if (!body) return '';
  return body.paragraphs
    .flatMap((p) => p.runs.map((r) => r.text))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Names a writer generates rather than a human types. Worse than the type word
 * they'd fall back to, because "TextBox 4" reads like a deliberate label.
 */
const GENERIC_NAME =
  /^(?:google shape;.*|(?:text ?box|rectangle|rounded rectangle|oval|ellipse|freeform|arrow|line|straight (?:arrow )?connector|elbow connector|picture|image|img|graphic|chart|table|group|shape|content|title|subtitle|body|slide|page)(?: placeholder)?\s*\d*)$/i;

const TYPE_LABEL: Record<ElementType, string> = {
  text: 'text box',
  shape: 'shape',
  picture: 'image',
  line: 'line',
  path: 'drawing',
};

const truncate = (s: string) => (s.length > 32 ? `${s.slice(0, 32)}…` : s);

/**
 * `siblings` is the slide's elements: an object pinned inside a group borrows
 * the group's text, since "the box behind the words" is not what the commenter
 * meant to point at.
 */
export function elementLabel(el: SlideElement, siblings: SlideElement[] = []): string {
  const own = elementText(el);
  if (own) return truncate(own);

  const groupId = el.groupIds?.[el.groupIds.length - 1];
  if (groupId) {
    const fromGroup = siblings
      .filter((s) => s.id !== el.id && s.groupIds?.includes(groupId))
      .map(elementText)
      .find(Boolean);
    if (fromGroup) return truncate(fromGroup);
  }

  if (el.name && !GENERIC_NAME.test(el.name.trim())) return truncate(el.name.trim());
  return el.role ?? TYPE_LABEL[el.type];
}

/**
 * Which of the selected objects the thread pins to. The first one is arbitrary
 * inside a group — often the backing rectangle — so prefer one that carries
 * text, which is what the commenter was reading when they hit ⌘⌥M.
 */
export function commentAnchorId(
  selectedIds: string[],
  elements: SlideElement[],
): string | undefined {
  if (!selectedIds.length) return undefined;
  const byId = new Map(elements.map((e) => [e.id, e]));
  for (const id of selectedIds) {
    const el = byId.get(id);
    if (el && elementText(el)) return id;
  }
  return selectedIds[0];
}
