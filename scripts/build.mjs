import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({
  entryPoints: ['src/app.ts', 'src/background.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  minify: true,
});
await build({
  entryPoints: ['src/content.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: true,
});
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
for (const file of ['app.js', 'background.js', 'content.js', 'index.html', 'popup.html', 'app.css'])
  await readFile(`dist/${file}`);
console.log(`Built ${manifest.name} ${manifest.version}`);
