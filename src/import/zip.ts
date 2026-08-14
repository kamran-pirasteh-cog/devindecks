/**
 * A minimal ZIP reader — enough to open an OPC package (.pptx is a zip).
 *
 * No dependency: the platform already ships a DEFLATE decoder in
 * `DecompressionStream('deflate-raw')`, available in every browser we target
 * and in Node 18+. Adding JSZip would ship ~100kB to do what one WHATWG stream
 * already does.
 *
 * We read the CENTRAL DIRECTORY rather than walking local file headers, because
 * local headers may carry zeroed sizes with the real values in a trailing data
 * descriptor — the central directory is always authoritative.
 */

export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflate. Anything else we refuse rather than guess. */
  method: number;
  offset: number;
  compressedSize: number;
  uncompressedSize: number;
}

const EOCD_SIG = 0x0605_4b50;
const EOCD64_LOCATOR_SIG = 0x0706_4b50;
const EOCD64_SIG = 0x0606_4b50;
const CEN_SIG = 0x0201_4b50;

export class ZipArchive {
  private constructor(
    private readonly bytes: Uint8Array,
    private readonly view: DataView,
    readonly entries: Map<string, ZipEntry>,
  ) {}

  static open(buffer: ArrayBuffer): ZipArchive {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const { count, dirOffset } = readEocd(view, bytes.length);

    const entries = new Map<string, ZipEntry>();
    let p = dirOffset;
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== CEN_SIG) break;
      const method = view.getUint16(p + 10, true);
      let compressedSize = view.getUint32(p + 20, true);
      let uncompressedSize = view.getUint32(p + 24, true);
      const nameLen = view.getUint16(p + 28, true);
      const extraLen = view.getUint16(p + 30, true);
      const commentLen = view.getUint16(p + 32, true);
      let localOffset = view.getUint32(p + 42, true);
      const name = utf8(bytes.subarray(p + 46, p + 46 + nameLen));

      // ZIP64: the 32-bit fields hold 0xFFFFFFFF and the real ones live in the
      // 0x0001 extra field, in the same order, present only for what overflowed.
      if (
        uncompressedSize === 0xffff_ffff ||
        compressedSize === 0xffff_ffff ||
        localOffset === 0xffff_ffff
      ) {
        let e = p + 46 + nameLen;
        const end = e + extraLen;
        while (e + 4 <= end) {
          const id = view.getUint16(e, true);
          const size = view.getUint16(e + 2, true);
          if (id === 0x0001) {
            let q = e + 4;
            if (uncompressedSize === 0xffff_ffff) {
              uncompressedSize = Number(view.getBigUint64(q, true));
              q += 8;
            }
            if (compressedSize === 0xffff_ffff) {
              compressedSize = Number(view.getBigUint64(q, true));
              q += 8;
            }
            if (localOffset === 0xffff_ffff) localOffset = Number(view.getBigUint64(q, true));
            break;
          }
          e += 4 + size;
        }
      }

      entries.set(name, {
        name,
        method,
        offset: localOffset,
        compressedSize,
        uncompressedSize,
      });
      p += 46 + nameLen + extraLen + commentLen;
    }

    return new ZipArchive(bytes, view, entries);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Raw bytes of one entry, inflating if needed. */
  async read(name: string): Promise<Uint8Array | null> {
    const entry = this.entries.get(name);
    if (!entry) return null;

    // The local header's own name/extra lengths tell us where the data starts;
    // the central directory's extra field is a different length in general.
    const h = entry.offset;
    const nameLen = this.view.getUint16(h + 26, true);
    const extraLen = this.view.getUint16(h + 28, true);
    const start = h + 30 + nameLen + extraLen;
    const raw = this.bytes.subarray(start, start + entry.compressedSize);

    if (entry.method === 0) return raw;
    if (entry.method !== 8) {
      throw new Error(`Unsupported zip compression method ${entry.method} for ${name}`);
    }
    return inflateRaw(raw);
  }

  async readText(name: string): Promise<string | null> {
    const bytes = await this.read(name);
    return bytes ? utf8(bytes) : null;
  }
}

async function inflateRaw(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  );
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function readEocd(view: DataView, size: number): { count: number; dirOffset: number } {
  // The EOCD sits at the end, after a comment of up to 64kB. Scan backwards.
  const min = Math.max(0, size - 0x1_0000 - 22);
  for (let p = size - 22; p >= min; p--) {
    if (view.getUint32(p, true) !== EOCD_SIG) continue;
    let count = view.getUint16(p + 10, true);
    let dirOffset = view.getUint32(p + 16, true);

    if (count === 0xffff || dirOffset === 0xffff_ffff) {
      const loc = p - 20;
      if (loc >= 0 && view.getUint32(loc, true) === EOCD64_LOCATOR_SIG) {
        const eocd64 = Number(view.getBigUint64(loc + 8, true));
        if (view.getUint32(eocd64, true) === EOCD64_SIG) {
          count = Number(view.getBigUint64(eocd64 + 32, true));
          dirOffset = Number(view.getBigUint64(eocd64 + 48, true));
        }
      }
    }
    return { count, dirOffset };
  }
  throw new Error('Not a zip archive (no end-of-central-directory record)');
}

const utf8 = (b: Uint8Array): string => new TextDecoder('utf-8').decode(b);
