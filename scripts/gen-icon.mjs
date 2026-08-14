// Generates src-tauri/icons/icon.ico (and icon.png) with zero dependencies:
// renders a lightning bolt on the Relay indigo (#6366F1), encodes a PNG by
// hand (zlib from Node), then wraps it in an ICO container (Vista+ PNG-in-ICO).
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 256;
const BG = [0x63, 0x66, 0xf1, 0xff]; // #6366F1 indigo
const FG = [0xff, 0xff, 0xff, 0xff]; // white bolt

// Lightning bolt polygon (zigzag), drawn top-right -> bottom-left.
const BOLT = [
  [178, 12],
  [52, 138],
  [112, 138],
  [78, 244],
  [206, 102],
  [146, 102],
];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  pixels[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const p = pointInPolygon(x, y, BOLT) ? FG : BG;
    const off = row + 1 + x * 4;
    pixels[off] = p[0];
    pixels[off + 1] = p[1];
    pixels[off + 2] = p[2];
    pixels[off + 3] = p[3];
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); // width
ihdr.writeUInt32BE(SIZE, 4); // height
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);

// ICO container (1 image entry)
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); // reserved
ico.writeUInt16LE(1, 2); // type: icon
ico.writeUInt16LE(1, 4); // count
ico[6] = 0; // width 256 (0 means 256)
ico[7] = 0; // height 256
ico[8] = 0; // color count
ico[9] = 0; // reserved
ico.writeUInt16LE(1, 10); // planes
ico.writeUInt16LE(32, 12); // bit count
ico.writeUInt32LE(png.length, 14); // bytes in resource
ico.writeUInt32LE(22, 18); // image offset

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "icon.ico"), Buffer.concat([ico, png]));
writeFileSync(join(outDir, "icon.png"), png);
console.log(`wrote icon.ico (${(ico.length + png.length).toFixed(0)} bytes) + icon.png`);
