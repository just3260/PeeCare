// PeeCare 本地測試工具 —— 網頁 UI + 後端代送 (proxy)
//
// 用途：在瀏覽器填表，發送「健康檢查 / 建立 device / 排尿事件 / 電量事件」四個 HTTP 請求。
// 瀏覽器只與本工具同源溝通，實際請求由此 Node 程式在 server side 轉發，
// 藉此避開 ingestion-api 未開啟 CORS 的限制。為安全起見，只允許送往 loopback 位址。
//
// 執行：node scripts/test-tool.mjs   然後開啟 http://127.0.0.1:5055
// 需 Node >= 18（內建 fetch）；專案 ingestion-api 需要 Node >= 22。

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = process.env.TOOL_PORT ? Number(process.env.TOOL_PORT) : 5055;
const HTML = readFileSync(new URL('./test-tool.html', import.meta.url), 'utf8');
// 裝置模擬器的排尿事件按鈕圖示；隨工具一起送出，頁面才不需外部資源。
const MACHINE_PNG = readFileSync(new URL('./machine.png', import.meta.url));
// 送出事件前在機器圖中間抖動的狗狗。
const DOG_PNG = readFileSync(new URL('./dog.png', import.meta.url));

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopback(target) {
  try {
    return LOOPBACK_HOSTS.has(new URL(target).hostname);
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error('request body too large'));
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && (req.url === '/machine.png' || req.url === '/dog.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
    res.end(req.url === '/machine.png' ? MACHINE_PNG : DOG_PNG);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/send') {
    try {
      const { method, url, headers, body } = JSON.parse((await readBody(req)) || '{}');
      if (typeof url !== 'string' || !isLoopback(url)) {
        return sendJson(res, 400, { ok: false, error: '只允許送往 loopback 位址（127.0.0.1 / localhost）' });
      }
      const startedAt = Date.now();
      const upstream = await fetch(url, {
        method: method ?? 'GET',
        headers: headers ?? {},
        body: body ?? undefined,
      });
      const text = await upstream.text();
      return sendJson(res, 200, {
        ok: true,
        status: upstream.status,
        statusText: upstream.statusText,
        elapsedMs: Date.now() - startedAt,
        body: text,
      });
    } catch (error) {
      return sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`PeeCare 本地測試工具已啟動：http://127.0.0.1:${PORT}`);
});
