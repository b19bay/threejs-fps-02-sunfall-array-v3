// main.ts — the entry program. Copies game/ and screenshots/ from the
// repository beside this file into the output directory and writes
// /output/dossier.json with the kit library buildDossier.
//
// CRITICAL: the output directory is a bind mount in the grader. NEVER delete
// the output directory itself (rmSync on it fails with EBUSY/EACCES and kills
// the run — this exact bug got our v1 round 1 REJECTED). Clean it by creating
// it if missing and deleting ONLY its children, one by one.
//
// Outside the grader:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const MAX_SCREENSHOTS = 4;
const MAX_SCREENSHOT_BYTES = 262144; // 256 KiB
const MAX_GAME_FILES = 993;
const MAX_GAME_BYTES = 50331648; // 48 MiB

interface TreeStats {
  files: number;
  bytes: number;
}

function treeStats(dir: string): TreeStats {
  let files = 0;
  let bytes = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      files += 1;
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else bytes += statSync(p).size;
    }
  };
  walk(dir);
  return { files, bytes };
}

function main(): void {
  const gameDir = join(ROOT, 'game');
  const shotsDir = join(ROOT, 'screenshots');
  if (!existsSync(gameDir)) throw new Error('main.ts: game/ is missing from the repository');
  if (!existsSync(shotsDir)) throw new Error('main.ts: screenshots/ is missing from the repository');

  // Validate the same caps the gate checks, before writing anything.
  const shots = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
  if (shots.length > MAX_SCREENSHOTS) {
    throw new Error(`main.ts: ${shots.length} screenshots, at most ${MAX_SCREENSHOTS} allowed`);
  }
  for (const name of shots) {
    const size = statSync(join(shotsDir, name)).size;
    if (size > MAX_SCREENSHOT_BYTES) {
      throw new Error(`main.ts: screenshot ${name} is ${size} bytes, at most ${MAX_SCREENSHOT_BYTES} allowed`);
    }
  }
  const game = treeStats(gameDir);
  if (game.files > MAX_GAME_FILES) {
    throw new Error(`main.ts: game/ holds ${game.files} files+dirs, at most ${MAX_GAME_FILES} allowed`);
  }
  if (game.bytes > MAX_GAME_BYTES) {
    throw new Error(`main.ts: game/ holds ${game.bytes} bytes, at most ${MAX_GAME_BYTES} allowed`);
  }

  // Clean the output directory WITHOUT removing the directory itself.
  mkdirSync(OUT, { recursive: true });
  for (const entry of readdirSync(OUT)) {
    rmSync(join(OUT, entry), { recursive: true, force: true });
  }

  cpSync(gameDir, join(OUT, 'game'), { recursive: true });
  cpSync(shotsDir, join(OUT, 'screenshots'), { recursive: true });

  const dossier = buildDossier(OUT, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  });
  writeFileSync(join(OUT, 'dossier.json'), dossier);
  console.log(`wrote ${OUT}/dossier.json (${dossier.length} bytes), game/ ${game.files} entries, ${shots.length} screenshots`);
}

main();
