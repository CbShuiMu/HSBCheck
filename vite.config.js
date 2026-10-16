import { defineConfig } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Bundle PDF.js supporting files locally; no CDN or third-party document service.
const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const version = JSON.parse(readFileSync(join(pdfRoot, 'package.json'), 'utf8')).version;
const output = join(import.meta.dirname, 'public', 'pdf-assets');
const stamp = join(output, '.version');
if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== version) {
  mkdirSync(output, { recursive: true });
  for (const directory of ['cmaps', 'standard_fonts', 'wasm']) cpSync(join(pdfRoot, directory), join(output, directory), { recursive: true });
  writeFileSync(stamp, version);
}
cpSync(join(pdfRoot, 'LICENSE'), join(output, 'LICENSE'));
export default defineConfig({ esbuild: { jsx: 'automatic' } });
