/**
 * server.mjs — Servidor Local HTTP (:3000) + HTTPS (:3443) con QR para probar ÓRBITA desde el móvil.
 * No requiere dependencias externas (usa módulos nativos de Node.js).
 */

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT_DIR = path.dirname(__filename);

const HTTP_PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon'
};

function getLocalLanIp() {
  const nets = os.networkInterfaces();
  // 1. Priorizar explícitamente la interfaz llamada "Wi-Fi" o "WLAN"
  for (const [name, list] of Object.entries(nets)) {
    if (!list || !/^(wi-fi|wlan)/i.test(name)) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  // 2. Cualquier IP 192.168.1.x o 192.168.0.x (redes domésticas habituales)
  let fallback = '127.0.0.1';
  for (const [name, list] of Object.entries(nets)) {
    if (!list) continue;
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        if (/^192\.168\.(0|1)\./.test(net.address)) {
          return net.address;
        }
        if (!net.address.startsWith('172.')) {
          fallback = net.address;
        }
      }
    }
  }
  return fallback;
}

/**
 * Generador nativo de código QR en SVG (Modo Byte, Nivel L, Versiones 2–4 ISO/IEC 18004)
 * para escanear directamente la URL desde la cámara del móvil.
 */
function generateQrSvg(text) {
  const dataBytes = Buffer.from(text, 'utf8');
  // Parámetros por versión (v2: 25x25, 34 bytes datos, 10 ECC; v3: 29x29, 55 bytes datos, 15 ECC)
  const ver = dataBytes.length <= 32 ? 2 : 3;
  const size = ver === 2 ? 25 : 29;
  const totalDataCodewords = ver === 2 ? 34 : 55;
  const ecCodewords = ver === 2 ? 10 : 15;
  const alignCenter = ver === 2 ? 18 : 22;

  // 1. Construir flujo de bits: Modo Byte (0100) + longitud (8 bits) + bytes + terminador (0000)
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };
  pushBits(0b0100, 4);
  pushBits(dataBytes.length, 8);
  for (const b of dataBytes) pushBits(b, 8);
  for (let i = 0; i < 4 && bits.length < totalDataCodewords * 8; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i + b];
    codewords.push(byte);
  }
  const padBytes = [0xEC, 0x11];
  let padIdx = 0;
  while (codewords.length < totalDataCodewords) {
    codewords.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // 2. Reed-Solomon GF(256) con polinomio 0x11D
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    gfExp[i] = x;
    gfLog[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) gfExp[i] = gfExp[i - 255];
  const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : gfExp[gfLog[a] + gfLog[b]];

  let gen = [1];
  for (let i = 0; i < ecCodewords; i++) {
    const next = new Array(gen.length + 1).fill(0);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j];
      next[j + 1] ^= gfMul(gen[j], gfExp[i]);
    }
    gen = next;
  }

  const ecc = new Array(ecCodewords).fill(0);
  for (const b of codewords) {
    const factor = b ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    for (let i = 0; i < ecCodewords; i++) {
      ecc[i] ^= gfMul(gen[i + 1], factor);
    }
  }

  const allWords = [...codewords, ...ecc];
  const finalBits = [];
  for (const w of allWords) {
    for (let i = 7; i >= 0; i--) finalBits.push((w >> i) & 1);
  }

  // 3. Matriz QR
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size).fill(0));

  const setFixed = (r, c, val) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      matrix[r][c] = val ? 1 : 0;
      reserved[r][c] = 1;
    }
  };

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6));
        const inInner = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setFixed(row + r, col + c, inOuter || inInner ? 1 : 0);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Patrón de alineamiento
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
      setFixed(alignCenter + r, alignCenter + c, dark ? 1 : 0);
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFixed(6, i, i % 2 === 0 ? 1 : 0);
    setFixed(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Dark module y reserva de información de formato
  setFixed(size - 8, 8, 1);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = 1;
    reserved[size - 1 - i][8] = 1;
  }

  // 4. Rellenar bits en zig-zag con máscara 0 ((r + c) % 2 === 0)
  let bitIdx = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = upward ? (size - 1 - i) : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          let bit = bitIdx < finalBits.length ? finalBits[bitIdx++] : 0;
          if ((r + c) % 2 === 0) bit ^= 1;
          matrix[r][c] = bit;
        }
      }
    }
    upward = !upward;
  }

  // 5. Bits de formato para Nivel L (01) + Máscara 0 (000) -> 0x77C4
  const formatBits = 0x77C4;
  const fCoords1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  const fCoords2 = [
    [size-1,8],[size-2,8],[size-3,8],[size-4,8],[size-5,8],[size-6,8],[size-7,8],
    [8,size-8],[8,size-7],[8,size-6],[8,size-5],[8,size-4],[8,size-3],[8,size-2],[8,size-1]
  ];
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >> i) & 1;
    matrix[fCoords1[i][0]][fCoords1[i][1]] = bit;
    matrix[fCoords2[i][0]][fCoords2[i][1]] = bit;
  }

  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#000"/>`;
      }
    }
  }
  const viewSize = size + 4;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" width="150" height="150" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/>${rects}</svg>`;
}

function handleRequest(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (urlObj.pathname === '/api/network-info') {
    const lanIp = getLocalLanIp();
    const httpUrl = `http://${lanIp}:${HTTP_PORT}`;
    const httpsUrl = `https://${lanIp}:${HTTPS_PORT}`;
    const qrSvg = generateQrSvg(httpsUrl);

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ lanIp, httpUrl, httpsUrl, qrSvg }));
    return;
  }

  let relPath = decodeURIComponent(urlObj.pathname);
  if (relPath === '/') relPath = '/index.html';

  const safePath = path.normalize(path.join(ROOT_DIR, relPath));
  if (!safePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 No encontrado');
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(safePath).pipe(res);
  });
}

// 1. Arrancar servidor HTTP en 0.0.0.0:3000
const httpServer = http.createServer(handleRequest);
httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  const ip = getLocalLanIp();
  console.log(`\n=============================================================`);
  console.log(`  ÓRBITA — Servidor Web Activo`);
  console.log(`  PC Local:    http://localhost:${HTTP_PORT}`);
  console.log(`  Móvil Wi-Fi: http://${ip}:${HTTP_PORT}`);
});

// 2. Generar o cargar certificado autofirmado para HTTPS (:3443) y habilitar Micrófono en Android/iOS
const certDir = path.join(ROOT_DIR, '.cert');
const pfxPath = path.join(certDir, 'orbita-local.pfx');
const PFX_PASS = 'orbita2026';

function ensureSelfSignedPfx() {
  if (fs.existsSync(pfxPath)) return true;
  try {
    fs.mkdirSync(certDir, { recursive: true });
    const ip = getLocalLanIp();
    const psCmd = [
      `$cert = New-SelfSignedCertificate -DnsName "localhost","${ip}" -CertStoreLocation "Cert:\\CurrentUser\\My" -NotAfter (Get-Date).AddYears(2);`,
      `$pwd = ConvertTo-SecureString -String "${PFX_PASS}" -Force -AsPlainText;`,
      `Export-PfxCertificate -Cert $cert -FilePath "${pfxPath}" -Password $pwd | Out-Null;`,
      `Remove-Item "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue;`
    ].join(' ');
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
    return fs.existsSync(pfxPath);
  } catch (_) {
    return false;
  }
}

if (ensureSelfSignedPfx()) {
  try {
    const pfxBuf = fs.readFileSync(pfxPath);
    const httpsServer = https.createServer({ pfx: pfxBuf, passphrase: PFX_PASS }, handleRequest);
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      const ip = getLocalLanIp();
      console.log(`  Móvil HTTPS: https://${ip}:${HTTPS_PORT}  (Habilita Micrófono Clave de Sol)`);
      console.log(`=============================================================\n`);
    });
  } catch (e) {
    console.log(`  (HTTPS no disponible: ${e.message})`);
  }
}
