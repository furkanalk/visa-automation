import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'apps/worker/src/config/portals');
const outDir = path.resolve(process.cwd(), 'apps/worker/dist/config/portals');

fs.mkdirSync(outDir, { recursive: true });

for (const f of fs.readdirSync(srcDir)) {
  if (!f.endsWith('.json')) continue;
  fs.copyFileSync(path.join(srcDir, f), path.join(outDir, f));
}

console.log(`[copy-configs] copied portal jsons to ${outDir}`);
