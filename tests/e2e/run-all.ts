/**
 * Run all E2E scenarios in sequence.
 * You run tests yourself; start CP, DP, mock-portal, Redis, Postgres first.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scenarios = ['happy-path', 'hitl', 'timeout-retry'];

async function run(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', `scenarios/${name}.ts`], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code === 0));
  });
}

async function main() {
  console.log('E2E run-all: ensure CP, DP, mock-portal, Redis, Postgres are running.\n');
  let failed = 0;
  for (const name of scenarios) {
    console.log(`\n--- ${name} ---\n`);
    const ok = await run(name);
    if (!ok) failed++;
  }
  console.log(`\nDone: ${scenarios.length - failed}/${scenarios.length} passed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
