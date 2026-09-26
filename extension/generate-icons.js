import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  table[i] = c;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, body, crcBuf]);
}

function createPng(size) {
  const width = size;
  const height = size;
  const rawData = Buffer.alloc((width * 4 + 1) * height);

  // Background purple: #7c3aed (124, 58, 237)
  // Accent lighter purple: #a855f7 (168, 85, 247)
  // Cap white: 255, 255, 255
  const radius = Math.floor(size * 0.22);
  const cx = width / 2;
  const cy = height / 2;

  let pos = 0;
  for (let y = 0; y < height; y++) {
    rawData[pos++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      // Rounded rectangle test
      const dx = Math.abs(x + 0.5 - cx);
      const dy = Math.abs(y + 0.5 - cy);
      const hw = width / 2 - 1;
      const hh = height / 2 - 1;

      let inBox = false;
      if (dx <= hw - radius && dy <= hh) inBox = true;
      else if (dy <= hh - radius && dx <= hw) inBox = true;
      else {
        const cdx = dx - (hw - radius);
        const cdy = dy - (hh - radius);
        if (cdx * cdx + cdy * cdy <= radius * radius) inBox = true;
      }

      if (!inBox) {
        // Transparent
        rawData[pos++] = 0;
        rawData[pos++] = 0;
        rawData[pos++] = 0;
        rawData[pos++] = 0;
        continue;
      }

      // Inside icon background - subtle gradient from top-left #9333ea to bottom-right #6d28d9
      const t = (x + y) / (width + height);
      let r = Math.round(147 * (1 - t) + 109 * t);
      let g = Math.round(51 * (1 - t) + 40 * t);
      let b = Math.round(234 * (1 - t) + 217 * t);
      let a = 255;

      // Draw graduation cap / mortarboard icon in white
      // Diamond top: center at (cx, cy - size * 0.08)
      const capCy = cy - size * 0.05;
      const rx = size * 0.32;
      const ry = size * 0.16;
      const dCap = Math.abs(x + 0.5 - cx) / rx + Math.abs(y + 0.5 - capCy) / ry;

      if (dCap <= 1.0) {
        // Mortarboard diamond top
        r = 255;
        g = 255;
        b = 255;
      } else {
        // Lower skullcap / arch
        const archY = capCy + size * 0.08;
        const archW = size * 0.20;
        const archH = size * 0.18;
        if (y + 0.5 >= archY && y + 0.5 <= archY + archH && Math.abs(x + 0.5 - cx) <= archW) {
          const normX = Math.abs(x + 0.5 - cx) / archW;
          const normY = (y + 0.5 - archY) / archH;
          if (normX * normX + normY * normY <= 1.0) {
            r = 255;
            g = 255;
            b = 255;
          }
        }
      }

      rawData[pos++] = r;
      rawData[pos++] = g;
      rawData[pos++] = b;
      rawData[pos++] = a;
    }
  }

  // Build PNG chunks
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', zlib.deflateSync(rawData, { level: 9 }));
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve('src/assets/icons');
fs.mkdirSync(iconsDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const buf = createPng(size);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, buf);
  console.log(`Generated ${filePath} (${buf.length} bytes, ${size}x${size}px)`);
}
