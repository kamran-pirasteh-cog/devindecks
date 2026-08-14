/**
 * A tiny XML reader for OOXML parts.
 *
 * Why not DOMParser: the import engine is a PURE layer (like the chart engine)
 * so it can be unit-tested in plain node and reused server-side — and node has
 * no DOMParser. Why not an XML library: OOXML is machine-generated, so the
 * hairy corners of general XML (DTDs, namespaced entity soup) never appear, and
 * this is ~150 lines against a dependency.
 *
 * Names are stored SPLIT into prefix + local, and every lookup here matches on
 * the local name. Prefixes in OOXML are conventional (`a:`, `p:`, `c:`) but not
 * guaranteed, and matching `a:off` literally is the classic import bug.
 */

export interface XmlNode {
  /** Local name, e.g. `off` for `<a:off>`. */
  name: string;
  /** Namespace prefix as written, e.g. `a`. Kept for diagnostics only. */
  prefix: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated direct text content (whitespace preserved). */
  text: string;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/** Parse an XML document and return its root element. */
export function parseXml(src: string): XmlNode {
  let i = 0;
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const makeNode = (qname: string, attrs: Record<string, string>): XmlNode => {
    const colon = qname.indexOf(':');
    return {
      name: colon < 0 ? qname : qname.slice(colon + 1),
      prefix: colon < 0 ? '' : qname.slice(0, colon),
      attrs,
      children: [],
      text: '',
    };
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) break;

    if (lt > i && stack.length) {
      stack[stack.length - 1].text += decodeEntities(src.slice(i, lt));
    }

    // Declarations, comments, CDATA, processing instructions.
    if (src.startsWith('<!--', lt)) {
      i = src.indexOf('-->', lt) + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt);
      if (stack.length) stack[stack.length - 1].text += src.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) {
      i = src.indexOf('>', lt) + 1;
      continue;
    }

    const gt = findTagEnd(src, lt);
    const inner = src.slice(lt + 1, gt);

    if (inner[0] === '/') {
      stack.pop();
      i = gt + 1;
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const nameEnd = firstWhitespace(body);
    const qname = nameEnd < 0 ? body : body.slice(0, nameEnd);
    const node = makeNode(qname, nameEnd < 0 ? {} : parseAttrs(body.slice(nameEnd)));

    if (stack.length) stack[stack.length - 1].children.push(node);
    else if (!root) root = node;
    if (!selfClosing) stack.push(node);

    i = gt + 1;
  }

  if (!root) throw new Error('Empty or malformed XML part');
  return root;
}

/** Skip past a `>` that sits inside an attribute value. */
function findTagEnd(src: string, from: number): number {
  let quote = '';
  for (let i = from + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return src.length;
}

const firstWhitespace = (s: string): number => s.search(/\s/);

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/* ------------------------------------------------------------------ */
/* Traversal helpers — all local-name based                           */
/* ------------------------------------------------------------------ */

/** First direct child with this local name. */
export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** All direct children with this local name. */
export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node?.children.filter((c) => c.name === name) ?? [];
}

/**
 * Walk a chain of local names: `path(sp, 'spPr', 'xfrm', 'off')`. Returns
 * undefined the moment a link is missing, which is the common case in OOXML
 * (nearly every property is optional and inherited).
 */
export function path(node: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  let cur = node;
  for (const n of names) {
    cur = child(cur, n);
    if (!cur) return undefined;
  }
  return cur;
}

/** First descendant with this local name, depth-first. */
export function descendant(node: XmlNode | undefined, name: string): XmlNode | undefined {
  if (!node) return undefined;
  for (const c of node.children) {
    if (c.name === name) return c;
    const found = descendant(c, name);
    if (found) return found;
  }
  return undefined;
}

/** Every descendant with this local name, depth-first. */
export function descendants(node: XmlNode | undefined, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  if (node) walk(node);
  return out;
}

export function attr(node: XmlNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const direct = node.attrs[name];
  if (direct !== undefined) return direct;
  // Namespaced attributes (`r:embed`, `xml:space`) — match on local name.
  for (const k of Object.keys(node.attrs)) {
    const colon = k.indexOf(':');
    if (colon >= 0 && k.slice(colon + 1) === name) return node.attrs[k];
  }
  return undefined;
}

export function numAttr(node: XmlNode | undefined, name: string): number | undefined {
  const v = attr(node, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An OOXML boolean attribute. Absent means "not specified" (undefined) so
 * callers can distinguish it from an explicit false — which matters everywhere
 * inheritance is involved: an unset `b` inherits bold from the placeholder,
 * `b="0"` overrides it back off.
 */
export function boolAttr(node: XmlNode | undefined, name: string): boolean | undefined {
  const v = attr(node, name);
  if (v === undefined) return undefined;
  return v === '1' || v === 'true' || v === 'on';
}

/** All text under a node, including nested elements. */
export function textOf(node: XmlNode | undefined): string {
  if (!node) return '';
  let out = node.text;
  for (const c of node.children) out += textOf(c);
  return out;
}
