// Long-lived CDP driver: one HTTP command per action against the Chrome that start.sh launched.
// Env: CDP_PORT, DRIVER_PORT, APP_URL. Commands are listed in the handlers object below.
import http from 'node:http';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const CDP = `http://localhost:${process.env.CDP_PORT}`;
const APP = new URL(process.env.APP_URL).host;
let ws, nextId = 1;
const pending = new Map();
const logs = [];
let rec = null; // { dir, frames: [{ file, ts }] }

async function connect() {
  const pages = (await (await fetch(`${CDP}/json/list`)).json()).filter((t) => t.type === 'page');
  const page = pages.find((t) => t.url.includes(APP)) || pages[0];
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      log(msg.params.type + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      log('EXCEPTION ' + JSON.stringify(msg.params.exceptionDetails));
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      log(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
    } else if (msg.method === 'Page.screencastFrame' && rec) {
      const file = `${rec.dir}/f${String(rec.frames.length).padStart(5, '0')}.jpg`;
      fs.writeFileSync(file, Buffer.from(msg.params.data, 'base64'));
      rec.frames.push({ file, ts: msg.params.metadata.timestamp });
      send('Page.screencastFrameAck', { sessionId: msg.params.sessionId });
    }
  });
  ws.addEventListener('close', () => { ws = null; });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  return page.url;
}

function log(line) {
  logs.push(line.slice(0, 2000));
  if (logs.length > 1000) logs.shift();
}

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', { type, x: +x, y: +y, button: 'left', clickCount: 1, ...extra });
}

async function png(path, extra = {}) {
  const r = await send('Page.captureScreenshot', { format: 'png', ...extra });
  fs.writeFileSync(path, Buffer.from(r.data, 'base64'));
  return path;
}

const handlers = {
  connect,
  async nav({ url }) { await send('Page.navigate', { url }); return 'ok'; },
  async reload() { await send('Page.reload', { ignoreCache: true }); return 'ok'; },
  async viewport({ width, height, mobile = 'false', scale = 1 }) {
    await send('Emulation.setDeviceMetricsOverride',
      { width: +width, height: +height, mobile: mobile === 'true', deviceScaleFactor: +scale });
    return 'ok';
  },
  async shot({ path }) { return png(path); },
  async fullshot({ path }) {
    const { cssContentSize: s } = await send('Page.getLayoutMetrics');
    return png(path, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: s.width, height: s.height, scale: 1 } });
  },
  async click({ x, y }) {
    await mouse('mouseMoved', x, y, { button: 'none' });
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
    return 'ok';
  },
  async hover({ x, y }) { await mouse('mouseMoved', x, y, { button: 'none' }); return 'ok'; },
  async scroll({ x, y, dy }) {
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: +x, y: +y, deltaX: 0, deltaY: +dy });
    return 'ok';
  },
  async type({ text }) { await send('Input.insertText', { text }); return 'ok'; },
  async key({ key }) {
    const codes = { Enter: 13, Tab: 9, Backspace: 8, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key] });
    }
    return 'ok';
  },
  // Flutter draws to a canvas, so there is no DOM text to query. This turns on Flutter's
  // semantics tree and returns the centre of every node whose label contains `text`.
  async find({ text = '' }) {
    return evaluate(`(async () => {
      document.querySelector('flt-semantics-placeholder')?.click();
      await new Promise((r) => setTimeout(r, 500));
      const hit = (e) => (e.getAttribute('aria-label') || e.innerText || e.value || '').toLowerCase()
        .includes(${JSON.stringify(text.toLowerCase())}) && e.getBoundingClientRect().width > 0;
      const all = [...document.querySelectorAll('flt-semantics, [role], input, textarea, button, a')].filter(hit);
      // Keep the innermost matches only; parents match too through innerText.
      return all.filter((e) => !all.some((o) => o !== e && e.contains(o))).map((e) => {
        const r = e.getBoundingClientRect();
        const label = (e.getAttribute('aria-label') || e.innerText || e.value).trim();
        return { label, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    })()`);
  },
  async eval({ expr }) { return evaluate(expr); },
  async logs({ n = 50, grep = '' }) { return logs.filter((l) => l.includes(grep)).slice(-n); },
  async tabs() { return (await (await fetch(`${CDP}/json/list`)).json()).filter((t) => t.type === 'page').map((t) => t.url); },
  async recstart({ dir = '/tmp/browser-qa-frames' }) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    rec = { dir, frames: [] };
    await send('Page.startScreencast', { format: 'jpeg', quality: 80 });
    return 'recording';
  },
  // Frames arrive only when the page repaints, so each frame keeps its real duration.
  async recstop({ out }) {
    await send('Page.stopScreencast');
    const { dir, frames } = rec;
    rec = null;
    if (!frames.length) throw new Error('no frames captured (page never repainted)');
    const lines = frames.flatMap((f, i) => [`file '${f.file}'`,
      `duration ${frames[i + 1] ? Math.max(frames[i + 1].ts - f.ts, 0.001).toFixed(3) : 0.5}`]);
    lines.push(`file '${frames.at(-1).file}'`);
    fs.writeFileSync(`${dir}/list.txt`, lines.join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${dir}/list.txt`,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-r', '30', '-c:v', 'libx264', '-crf', '26', out]);
    return `${out} (${frames.length} frames)`;
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const handler = handlers[url.pathname.slice(1)];
  try {
    if (!handler) throw new Error(`unknown command; try: ${Object.keys(handlers).join(', ')}`);
    if (!ws && handler !== connect) await connect();
    res.end(JSON.stringify(await handler(Object.fromEntries(url.searchParams))) + '\n');
  } catch (e) {
    res.statusCode = 500;
    res.end(String(e.stack || e) + '\n');
  }
}).listen(process.env.DRIVER_PORT, 'localhost');
