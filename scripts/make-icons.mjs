// Renders the PNG icons from public/icons/icon.svg (the app's existing icon design).
// Run: npm run icons
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
const render = (size) => sharp(svg, { density: 512 }).resize(size, size).flatten({ background: '#ffffff' }).png();

await render(180).toFile(out('apple-touch-icon.png'));
await render(192).toFile(out('icon-192.png'));
await render(512).toFile(out('icon-512.png'));
// Maskable: keep the artwork inside the 80% safe zone.
const inner = await sharp(svg, { density: 512 }).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#ffffff' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile(out('icon-512-maskable.png'));
console.log('Icons written to public/icons/');
