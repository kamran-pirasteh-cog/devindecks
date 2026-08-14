/**
 * The OPC layer: a .pptx is a zip of PARTS wired together by RELATIONSHIPS.
 *
 * Nothing in the package is addressed by a fixed path — `ppt/slides/slide1.xml`
 * is a convention, not a guarantee. The presentation part lists its slides by
 * relationship id, each slide points at its layout, each layout at its master,
 * each master at its theme, and images/charts hang off whichever part uses
 * them. This module is the only place that knows about paths and r:ids;
 * everything above it asks for "the layout of this slide".
 */
import { ZipArchive } from '../zip';
import { attr, children, parseXml, type XmlNode } from '../xml';

export interface Relationship {
  id: string;
  /** Full relationship type URI; callers match on its last segment. */
  type: string;
  /** Package-absolute part name, already resolved against the source part. */
  target: string;
  external: boolean;
}

export class OpcPackage {
  private readonly xmlCache = new Map<string, XmlNode>();
  private readonly relCache = new Map<string, Map<string, Relationship>>();

  private constructor(private readonly zip: ZipArchive) {}

  static async open(buffer: ArrayBuffer): Promise<OpcPackage> {
    return new OpcPackage(ZipArchive.open(buffer));
  }

  has(part: string): boolean {
    return this.zip.has(part);
  }

  async xml(part: string): Promise<XmlNode | undefined> {
    const cached = this.xmlCache.get(part);
    if (cached) return cached;
    const text = await this.zip.readText(part);
    if (text === null) return undefined;
    const node = parseXml(text);
    this.xmlCache.set(part, node);
    return node;
  }

  async bytes(part: string): Promise<Uint8Array | null> {
    return this.zip.read(part);
  }

  /** The relationships declared BY a part, keyed by r:id. */
  async rels(part: string): Promise<Map<string, Relationship>> {
    const cached = this.relCache.get(part);
    if (cached) return cached;

    const relPart = relsPathFor(part);
    const map = new Map<string, Relationship>();
    const text = await this.zip.readText(relPart);
    if (text) {
      const root = parseXml(text);
      for (const r of children(root, 'Relationship')) {
        const id = attr(r, 'Id');
        const type = attr(r, 'Type');
        const target = attr(r, 'Target');
        if (!id || !type || !target) continue;
        const external = attr(r, 'TargetMode') === 'External';
        map.set(id, {
          id,
          type,
          external,
          target: external ? target : resolvePath(part, target),
        });
      }
    }
    this.relCache.set(part, map);
    return map;
  }

  /** Follow one r:id from `part`, returning the target part name. */
  async related(part: string, rId: string | undefined): Promise<string | undefined> {
    if (!rId) return undefined;
    const rel = (await this.rels(part)).get(rId);
    return rel && !rel.external ? rel.target : undefined;
  }

  /** The single related part of a given relationship type (layout, master, theme). */
  async relatedByType(part: string, typeSuffix: string): Promise<string | undefined> {
    for (const rel of (await this.rels(part)).values()) {
      if (!rel.external && rel.type.endsWith(`/${typeSuffix}`)) return rel.target;
    }
    return undefined;
  }

  /** Slides in presentation order. */
  async slideParts(): Promise<string[]> {
    const presPart = await this.presentationPart();
    const pres = await this.xml(presPart);
    const rels = await this.rels(presPart);
    const list = children(children(pres, 'sldIdLst')[0], 'sldId');
    const parts: string[] = [];
    for (const s of list) {
      const target = rels.get(attr(s, 'id') ?? '')?.target;
      if (target) parts.push(target);
    }
    // A package with no sldIdLst (or an unreadable one) still has slides on
    // disk; ordering by the numeric suffix beats importing nothing.
    if (!parts.length) {
      return this.zip
        .names()
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => slideNo(a) - slideNo(b));
    }
    return parts;
  }

  async presentationPart(): Promise<string> {
    const rootRels = await this.rels('');
    for (const rel of rootRels.values()) {
      if (rel.type.endsWith('/officeDocument')) return rel.target;
    }
    return 'ppt/presentation.xml';
  }
}

const slideNo = (name: string): number => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

/** `ppt/slides/slide1.xml` -> `ppt/slides/_rels/slide1.xml.rels`. */
export function relsPathFor(part: string): string {
  if (part === '') return '_rels/.rels';
  const slash = part.lastIndexOf('/');
  const dir = slash < 0 ? '' : part.slice(0, slash + 1);
  const file = part.slice(slash + 1);
  return `${dir}_rels/${file}.rels`;
}

/** Resolve a relationship target (usually relative, e.g. `../media/x.png`). */
export function resolvePath(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const baseDir = fromPart.slice(0, Math.max(0, fromPart.lastIndexOf('/')));
  const segments = baseDir ? baseDir.split('/') : [];
  for (const seg of target.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') segments.pop();
    else segments.push(seg);
  }
  return segments.join('/');
}
