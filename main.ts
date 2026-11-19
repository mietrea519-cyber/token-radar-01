// Launch Radar entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot (at /input/snapshot.json in the grader's
// container, or wherever --input points), builds the ranked board with the
// model in lib/model.ts, and writes the hand-in into the output directory
// (/output, or $MAKEFUN_OUTPUT_DIR, or --output):
//   board.json    the ranked rows the gate checks
//   data.js       the same board for the dashboard page
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's summary, written last by vendor/makefun-board.ts
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardProblem, buildBoard, dataScript, readSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const root = dirname(fileURLToPath(import.meta.url));

function flagValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1 && args[at + 1] !== undefined) return args[at + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`launch radar: ${message}\n`);
  process.exit(1);
}

const inputPath = flagValue('input') ?? '/input/snapshot.json';
const snapshotFile = inputPath.endsWith('.json') ? inputPath : join(inputPath, 'snapshot.json');
if (!existsSync(snapshotFile)) {
  fail(`no snapshot at ${snapshotFile}: pass --input <snapshot.json|directory>`);
}
const outDir = flagValue('output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = readSnapshot(readFileSync(snapshotFile, 'utf8'));
const built = buildBoard(snapshot);
const problem = boardProblem(built.rows, snapshot);
if (problem !== null) fail(`the model built a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: built.rows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(built));

/** Copy a directory tree of regular files, skipping dot names, and list what was copied. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, dst).map((n) => `${name}/${n}`));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied.push(name);
    }
  }
  return copied;
}

const dashboardFiles = copyTree(join(root, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyTree(join(root, 'screenshots'), join(outDir, 'screenshots'));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
if (shotFiles.length < 3 || shotFiles.length > 4) {
  fail(`screenshots/ holds ${shotFiles.length} files: hand in 3 or 4, the board, a detail view and a filtered view`);
}
for (const name of shotFiles) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: names are letters, digits and . _ -, 1 to 128 characters`);
}

// Written last, from the finished output, so the dossier matches it byte for byte.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

const s = built.stats;
process.stdout.write(
  `launch radar: scanned ${s.scanned} protocols, set aside ${s.tokenised} with a token recorded and ${s.shells} shell products, ranked ${s.board_size} pre-token protocols (watchlist ${s.watchlist_covered}/${s.watchlist_size})\n` +
    `launch radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shotFiles.length} images) and dossier.json to ${outDir}\n`,
);
