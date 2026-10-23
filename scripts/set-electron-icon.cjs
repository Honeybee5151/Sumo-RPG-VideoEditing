const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

function generateWin32IcoFromPng(pngPath, icoTargets) {
  if (!fs.existsSync(pngPath)) return;
  const png = fs.readFileSync(pngPath);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);

  const idat = [];
  let offset = 8;
  while (offset < png.length) {
    const len = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const srcPixels = Buffer.alloc(width * height * 4);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const rowIn = y * (stride + 1) + 1;
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[rowIn + x];
      const a = x >= bpp ? srcPixels[rowOut + x - bpp] : 0;
      const b = y > 0 ? srcPixels[rowOut - stride + x] : 0;
      const c = x >= bpp && y > 0 ? srcPixels[rowOut - stride + x - bpp] : 0;
      let out = v;
      if (filter === 1) out = (v + a) & 0xff;
      else if (filter === 2) out = (v + b) & 0xff;
      else if (filter === 3) out = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) out = (v + paeth(a, b, c)) & 0xff;
      srcPixels[rowOut + x] = out;
    }
  }

  function makeDibFrame(size) {
    const xorSize = size * size * 4;
    const andRowBytes = Math.ceil(size / 32) * 4;
    const andSize = andRowBytes * size;
    const buf = Buffer.alloc(40 + xorSize + andSize);
    buf.writeUInt32LE(40, 0); // biSize
    buf.writeInt32LE(size, 4); // biWidth
    buf.writeInt32LE(size * 2, 8); // biHeight (XOR + AND)
    buf.writeUInt16LE(1, 12); // biPlanes
    buf.writeUInt16LE(32, 14); // biBitCount
    buf.writeUInt32LE(0, 16); // biCompression = BI_RGB
    buf.writeUInt32LE(xorSize + andSize, 20); // biSizeImage

    let p = 40;
    for (let y = size - 1; y >= 0; y--) {
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / size));
      for (let x = 0; x < size; x++) {
        const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / size));
        const si = (sy * width + sx) * 4;
        buf[p++] = srcPixels[si + 2]; // B
        buf[p++] = srcPixels[si + 1]; // G
        buf[p++] = srcPixels[si + 0]; // R
        buf[p++] = srcPixels[si + 3]; // A
      }
    }
    return buf;
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const frames = sizes.map((s) => ({ size: s, data: makeDibFrame(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  let dataOffset = 6 + frames.length * 16;
  for (const f of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 0);
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(f.data.length, 8);
    entry.writeUInt32LE(dataOffset, 12);
    dirEntries.push(entry);
    dataOffset += f.data.length;
  }

  const ico = Buffer.concat([header, ...dirEntries, ...frames.map((f) => f.data)]);
  for (const target of icoTargets) {
    fs.writeFileSync(target, ico);
  }
}

async function main() {
  const rootDir = path.join(__dirname, '..');
  const pngPath = path.join(rootDir, 'public', 'sumo-logo.png');
  const icoPath = path.join(rootDir, 'public', 'sumo-icon.ico');
  const faviconPath = path.join(rootDir, 'src', 'app', 'favicon.ico');

  generateWin32IcoFromPng(pngPath, [icoPath, faviconPath]);

  if (process.platform !== 'win32') return;

  const exePath = path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!fs.existsSync(exePath) || !fs.existsSync(icoPath)) {
    return;
  }

  try {
    const rceditModule = require('rcedit');
    const rcedit = rceditModule.rcedit || rceditModule.default || rceditModule;
    await rcedit(exePath, {
      icon: icoPath,
      'version-string': {
        ProductName: 'Sumo VideoEditor',
        FileDescription: 'Sumo VideoEditor',
        CompanyName: 'Sumo RPG',
        InternalName: 'Sumo VideoEditor',
        OriginalFilename: 'Sumo VideoEditor.exe',
      },
    });
    console.log('Successfully applied Sumo VideoEditor icon to electron.exe');
  } catch (err) {
    console.warn('Could not patch electron.exe icon:', err.message);
  }
}

main();
