import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
// Only recreate this project's generated output directory.
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'app.js', 'style.css', 'LICENSE']) {
    await copyFile(new URL(file, root), new URL(file, dist));
}
await cp(new URL('edge-functions/', root), new URL('edge-functions/', dist), { recursive: true });
await cp(new URL('assets/', root), new URL('assets/', dist), { recursive: true });
console.log('Built dist/: static assets + EdgeOne functions');
