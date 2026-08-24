import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const geometry = JSON.parse(await readFile(path.join(root, 'src', 'brand', 'brand-geometry.json'), 'utf8'));
const size = 1024; const cyan = [103, 223, 255, 255]; const ink = [4, 7, 11, 255];
const insideSegment = (angle) => geometry.segments.some(([start, end]) => angle >= start && angle <= end);

function render({ background, scale }) {
  const png = new PNG({ width: size, height: size }); const unit = size / 64 * scale; const outer = geometry.outerRadius * unit; const inner = geometry.ringRadius * unit; const pupil = geometry.pupilRadius * unit; const outerStroke = 4 * unit; const innerStroke = 3 * unit;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const offset = (y * size + x) * 4; const dx = x + 0.5 - size / 2; const dy = y + 0.5 - size / 2; const distance = Math.hypot(dx, dy); const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const isMark = (Math.abs(distance - outer) <= outerStroke / 2 && insideSegment(angle)) || Math.abs(distance - inner) <= innerStroke / 2 || distance <= pupil;
    const color = isMark ? cyan : background === 'ink' ? ink : [0, 0, 0, 0]; png.data[offset] = color[0]; png.data[offset + 1] = color[1]; png.data[offset + 2] = color[2]; png.data[offset + 3] = color[3];
  }
  return PNG.sync.write(png);
}

await mkdir(assets, { recursive: true });
await Promise.all([writeFile(path.join(assets, 'icon.png'), render({ background: 'ink', scale: 0.58 })), writeFile(path.join(assets, 'adaptive-icon.png'), render({ background: 'transparent', scale: 0.46 })), writeFile(path.join(assets, 'splash-icon.png'), render({ background: 'transparent', scale: 0.72 }))]);
console.log('Generated SKR Eyes brand assets from src/brand/brand-geometry.json');
