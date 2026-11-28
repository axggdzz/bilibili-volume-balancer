/**
 * 可选的真实浏览器端到端测试。
 *
 * 依赖：
 *   - 本机安装 Microsoft Edge（或通过 EDGE_PATH 指定 Chromium 内核浏览器）
 *   - 允许启动浏览器进程（DSH 的 workspace-write 沙箱会拦截 Chromium 的 mojo 通道，
 *     需要在 danger-full-access 下运行）
 *
 * 运行：
 *   node test/e2e/run.mjs
 *
 * 它会启动一个本地 HTTP 服务，打开 harness.html（前 10 秒 -41.7 LUFS，后 20 秒 -11.8 LUFS），
 * 等扩展接管播放器后读取 window.__bvbDebug()，检查增益是否先提升、后衰减。
 *
 * 传入 iframe-harness.html 可以测试同源 iframe 里的视频（模拟 B 站直播播放器）：
 *   node test/e2e/run.mjs iframe-harness.html
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const HARNESS = process.argv[2]
  ? `/test/e2e/${process.argv[2].replace(/^.*[\\/]/, '')}`
  : '/test/e2e/harness.html';
const PORT = Number(process.env.BVB_E2E_PORT || 8765);
const DEBUG_PORT = Number(process.env.BVB_DEBUG_PORT || 9223);
const EDGE = process.env.EDGE_PATH
  || [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((candidate) => existsSync(candidate));

if (!existsSync(EDGE)) {
  console.error(`找不到浏览器：${EDGE}`);
  console.error('请设置 EDGE_PATH 指向 msedge.exe / chrome.exe。');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function startServer() {
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = urlPath === '/' ? HARNESS : urlPath;
      const file = normalize(join(ROOT, relative));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const stat = statSync(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const match = /bytes=(\d+)-(\d*)/.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : stat.size - 1;
          res.writeHead(206, {
            'Content-Type': type,
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
          });
          res.end(readFileSync(file).subarray(start, end + 1));
          return;
        }
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
      });
      res.end(readFileSync(file));
    } catch (error) {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(PORT, '127.0.0.1', () => resolvePromise(server));
  });
}

async function waitForJson(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw lastError || new Error(`timeout waiting for ${url}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const server = await startServer();
  const profile = join(HERE, '.edge-profile');
  rmSync(profile, { recursive: true, force: true });

  const url = `http://127.0.0.1:${PORT}${HARNESS}`;
  const browser = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-crash-reporter',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1000,700',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  browser.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const cleanup = async () => {
    try { browser.kill(); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    try { server.close(); } catch {}
    rmSync(profile, { recursive: true, force: true });
  };

  try {
    const version = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 15000);
    const targets = await waitForJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`, 5000);
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('没有找到页面调试目标');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolvePromise, rejectPromise) => {
      ws.addEventListener('open', resolvePromise, { once: true });
      ws.addEventListener('error', rejectPromise, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });

    const send = (method, params = {}) => new Promise((resolvePromise, rejectPromise) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'evaluate failed');
      }
      return result.result ? result.result.value : undefined;
    };

    await send('Runtime.enable');
    await sleep(1500);

    if (HARNESS.includes('iframe')) {
      const point = await evaluate(`(() => {
        const rect = document.querySelector('iframe').getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
      await sleep(1200);
    }

    const early = await evaluate('window.__bvbDebug ? window.__bvbDebug() : null');
    await sleep(6500);
    const quiet = await evaluate('window.__bvbDebug ? window.__bvbDebug() : null');
    await sleep(9000);
    const loud = await evaluate('window.__bvbDebug ? window.__bvbDebug() : null');

    // 把 B 站音量条模拟调到 50%。如果音量补偿正确，视频本身的响度和增益都不应变化。
    const videoExpression = `(document.querySelector("video") || document.querySelector("iframe")?.contentDocument?.querySelector("video"))`;
    await evaluate(`${videoExpression}.volume = 0.5; true`);
    await sleep(4000);
    const halfVolume = await evaluate('window.__bvbDebug ? window.__bvbDebug() : null');
    await evaluate(`${videoExpression}.volume = 1; true`);

    const panelBefore = await evaluate(`(() => {
      const host = document.getElementById('bvb-panel-host');
      const shadow = host.shadowRoot;
      const head = shadow.querySelector('.head').getBoundingClientRect();
      return { left: host.style.left, top: host.style.top, head: { x: head.x + head.width / 2, y: head.y + head.height / 2 } };
    })()`);

    await evaluate(`document.getElementById('bvb-panel-host').shadowRoot.getElementById('bvb-collapse').click(); true`);
    await sleep(250);
    const collapsed = await evaluate('window.__bvbDebug()');

    await evaluate(`document.getElementById('bvb-panel-host').shadowRoot.getElementById('bvb-mini').click(); true`);
    await sleep(250);
    const expanded = await evaluate('window.__bvbDebug()');

    await evaluate(`(() => {
      const shadow = document.getElementById('bvb-panel-host').shadowRoot;
      const range = shadow.getElementById('bvb-opacity');
      range.value = '60';
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    const faded = await evaluate('window.__bvbDebug()');

    await evaluate(`(() => {
      const shadow = document.getElementById('bvb-panel-host').shadowRoot;
      const select = shadow.getElementById('bvb-target');
      select.value = 'custom';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const input = shadow.getElementById('bvb-target-custom');
      input.value = '-23.5';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(150);
    const customTarget = await evaluate('window.__bvbDebug()');

    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: panelBefore.head.x,
      y: panelBefore.head.y,
      button: 'left',
      clickCount: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: panelBefore.head.x + 80,
      y: panelBefore.head.y - 45,
      button: 'left',
      buttons: 1,
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: panelBefore.head.x + 80,
      y: panelBefore.head.y - 45,
      button: 'left',
      clickCount: 1,
    });
    await sleep(300);
    const dragged = await evaluate('window.__bvbDebug()');

    let fullscreen = null;
    const enteredFullscreen = await evaluate(`(async () => {
      try {
        await document.documentElement.requestFullscreen();
        return true;
      } catch {
        return false;
      }
    })()`);
    if (enteredFullscreen) {
      await sleep(350);
      fullscreen = await evaluate('window.__bvbDebug()');
      await sleep(2200);
      const fullscreenHidden = await evaluate('window.__bvbDebug()');
      await evaluate('document.exitFullscreen().catch(() => {}); true');
      await sleep(350);
      const restored = await evaluate('window.__bvbDebug()');
      Object.assign(fullscreen, { hiddenState: fullscreenHidden, restored });
    }

    const savedSettings = await evaluate(`JSON.parse(localStorage.getItem('bvb:settings') || 'null')`);

    console.log(JSON.stringify({
      browser: version.Browser,
      early,
      quiet,
      loud,
      halfVolume,
      ui: { panelBefore, collapsed, expanded, faded, customTarget, dragged, fullscreen, savedSettings },
    }, null, 2));

    const failures = [];
    if (!quiet || quiet.ctxState !== 'running') failures.push('AudioContext 未运行');
    if (!quiet || !quiet.source) failures.push('未接管 video 音频');
    if (!quiet || !quiet.meterData || !(quiet.meterData.blocks > 25)) failures.push('没有收到响度测量');
    if (!quiet || !(quiet.appliedDb > 8)) failures.push(`安静段应提升增益，实际 ${quiet && quiet.appliedDb}`);
    if (!loud || !(loud.appliedDb < 0)) failures.push(`大声段应衰减增益，实际 ${loud && loud.appliedDb}`);
    if (quiet && quiet.unsupportedReason) failures.push(`进入不支持状态：${quiet.unsupportedReason}`);
    if (!halfVolume || Math.abs(halfVolume.appliedDb - loud.appliedDb) > 1.5) {
      failures.push(`50% 音量时增益不应变化，实际 ${halfVolume && halfVolume.appliedDb}（100% 时 ${loud.appliedDb}）`);
    }
    if (!collapsed || !collapsed.panel || collapsed.panel.collapsed !== 'true') failures.push('面板未收起');
    if (!expanded || !expanded.panel || expanded.panel.collapsed !== 'false') failures.push('面板未展开');
    if (!faded || !faded.panel || Math.abs(Number.parseFloat(faded.panel.opacity) - 0.6) > 0.08) {
      failures.push(`透明度未生效，实际 ${faded && faded.panel && faded.panel.opacity}`);
    }
    if (!customTarget || !customTarget.panel || customTarget.panel.targetMode !== 'custom'
      || Math.abs(customTarget.panel.targetLufs - -23.5) > 0.01) {
      failures.push(`手动目标响度未生效，实际 ${customTarget && customTarget.panel && customTarget.panel.targetLufs}`);
    }
    if (!dragged || !dragged.panel || dragged.panel.left === panelBefore.left) failures.push('面板拖动未生效');
    if (fullscreen && (!fullscreen.panel || fullscreen.panel.fullscreen !== 'true' || fullscreen.panel.collapsed !== 'true')) {
      failures.push('全屏时面板未自动收起');
    }
    if (fullscreen && (!fullscreen.hiddenState || !fullscreen.hiddenState.panel
      || fullscreen.hiddenState.panel.dockHidden !== 'true')) {
      failures.push('全屏时面板未贴边隐藏');
    }
    if (fullscreen && (!fullscreen.restored || !fullscreen.restored.panel
      || fullscreen.restored.panel.fullscreen !== 'false'
      || fullscreen.restored.panel.collapsed !== 'false')) {
      failures.push('退出全屏后面板未恢复');
    }
    if (!savedSettings || Math.abs(savedSettings.opacity - 0.6) > 0.01
      || savedSettings.targetMode !== 'custom' || Math.abs(savedSettings.targetLufs - -23.5) > 0.01) {
      failures.push('面板设置未持久化');
    }

    if (failures.length) {
      console.error('\nE2E 失败：');
      for (const failure of failures) console.error(' - ' + failure);
      if (stderr.trim()) console.error('\n浏览器 stderr 尾部：\n' + stderr.slice(-4000));
      process.exitCode = 1;
    } else {
      console.log('\nE2E 通过：安静段提升，响段衰减。');
    }

    ws.close();
  } finally {
    await cleanup();
  }
}

run().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
