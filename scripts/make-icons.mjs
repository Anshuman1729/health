// Renders the PNG icons from public/icons/icon.svg: the original app's icon
// (violet square + white pulse line) drawn full-bleed, because iOS and Android
// round the corners themselves. The pulse line sits inside the 80% maskable
// safe zone, so the same artwork is valid as a maskable icon.
// Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  await sharp(svg, { density: 1024 }).resize(size, size).flatten({ background: '#4F3BFF' }).png().toFile(out(name));
}
console.log('Icons written to public/icons/');
