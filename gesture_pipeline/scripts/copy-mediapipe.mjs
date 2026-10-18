// Prepare assets in the host Vite app: npm run assets -- --public-dir ../client/public
import { cpSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--public-dir' || !args[1])) {
  throw new Error('Usage: node scripts/copy-mediapipe.mjs [--public-dir path/to/app/public]');
}
const publicDir = args.length ? resolve(args[1]) : resolve(packageRoot, 'public');
const require = createRequire(import.meta.url);
const visionRoot = dirname(require.resolve('@mediapipe/tasks-vision'));
const modelSource = resolve(packageRoot, 'public/models/hand_landmarker.task');
if (!existsSync(modelSource)) throw new Error('Missing hand model: public/models/hand_landmarker.task');
mkdirSync(resolve(publicDir, 'mediapipe'), { recursive: true });
mkdirSync(resolve(publicDir, 'models'), { recursive: true });
cpSync(resolve(visionRoot, 'wasm'), resolve(publicDir, 'mediapipe/wasm'), { recursive: true });
copyFileSync(resolve(visionRoot, 'vision_bundle.cjs'), resolve(publicDir, 'mediapipe/vision_bundle.js'));
const modelTarget = resolve(publicDir, 'models/hand_landmarker.task');
if (modelSource !== modelTarget) copyFileSync(modelSource, modelTarget);
console.log(`[gestures] Model, worker loader and WASM runtime prepared in ${publicDir}`);
