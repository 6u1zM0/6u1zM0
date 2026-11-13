// Frame renderer: serves ./src, drives headless Chromium, pipes JPEG frames into ffmpeg.
//   node src/render.mjs stills 1.5,6.2,...          -> out/stills/t_XXX.jpg
//   node src/render.mjs range <f0> <f1> <file.mp4>  -> video segment for frames [f0,f1)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FPS = 30;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = p.startsWith('/node_modules/') ? path.join(ROOT, p) : path.join(ROOT, 'src', p);
  fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(d); } });
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.error('[page]', m.text()); });
page.on('pageerror', e => console.error('[pageerror]', e.message));
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction('window.READY || window.ERR', null, { timeout: 120000 });
const err = await page.evaluate('window.ERR'); if (err) { console.error(err); process.exit(1); }
const grab = async (t, q) => Buffer.from((await page.evaluate(([t, q]) => { window.renderFrame(t); return window.grab(q); }, [t, q])).split(',')[1], 'base64');

const [mode, ...a] = process.argv.slice(2);
if (mode === 'stills') {
  console.log(JSON.stringify(await page.evaluate('window.INFO')));
  fs.mkdirSync(path.join(ROOT, 'out/stills'), { recursive: true });
  for (const s of a[0].split(',')) { const t = parseFloat(s); const t0 = Date.now(); fs.writeFileSync(path.join(ROOT, `out/stills/t_${t.toFixed(2).padStart(6, '0')}.jpg`), await grab(t, 0.9)); console.log(t, Date.now() - t0, 'ms'); }
} else if (mode === 'range') {
  const f0 = +a[0], f1 = +a[1];
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', a[3] || '17', '-pix_fmt', 'yuv420p', '-g', '60', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709', a[2]], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = f0; f < f1; f++) {
    const buf = await grab(f / FPS, 0.97);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 150 === 0) console.log(`[${f0}-${f1}] frame ${f}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
}
await browser.close(); server.close();
