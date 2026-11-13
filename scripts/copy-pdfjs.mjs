// Copie les fichiers du lecteur PDF (pdf.js) dans public/pdfjs/<version>.
// Le numéro de version dans l'adresse permet de les garder en cache sur les téléphones
// sans risque de mélange entre deux versions. À relancer après chaque mise à jour de
// pdfjs-dist : npm run pdfjs (puis enregistrer le nouveau dossier dans git).
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const from = 'node_modules/pdfjs-dist';
const { version } = JSON.parse(readFileSync(`${from}/package.json`, 'utf8'));
const to = `public/pdfjs/${version}`;
rmSync('public/pdfjs', { recursive: true, force: true });
mkdirSync(`${to}/wasm`, { recursive: true });
cpSync(`${from}/legacy/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
for (const file of [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
  'LICENSE_JBIG2',
  'LICENSE_OPENJPEG',
  'LICENSE_PDFJS_JBIG2',
  'LICENSE_PDFJS_OPENJPEG',
  'LICENSE_PDFJS_QCMS',
])
  cpSync(`${from}/wasm/${file}`, `${to}/wasm/${file}`);
cpSync(`${from}/standard_fonts`, `${to}/standard_fonts`, { recursive: true });
cpSync(`${from}/LICENSE`, `${to}/LICENSE`);
console.log(`pdf.js ${version} copié dans ${to}`);
