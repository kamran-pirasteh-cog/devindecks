import { writeFileSync } from 'node:fs';
import { buildPptx } from '@/export/pptx';
import { DEFAULT_DESIGN_SYSTEM } from '@/model';
import { SAMPLE_DECK } from '@/model/sample';

async function main() {
  const pptx = buildPptx(SAMPLE_DECK, DEFAULT_DESIGN_SYSTEM);
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
  const out = process.argv[2] ?? '/tmp/dd-sample.pptx';
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
