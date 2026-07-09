const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// 多后端配置：JUDGE0_URLS 以逗号分隔，优先级按顺序
// 例如：https://ce.judge0.com,https://your-backup.com
const JUDGE0_URLS = (process.env.JUDGE0_URLS || 'https://ce.judge0.com').split(',').map(s => s.trim());
const FAIL_THRESHOLD = 3;
const FAIL_COOLDOWN_MS = 5 * 60 * 1000;

// 每个后端的状态跟踪
const backendState = {};
JUDGE0_URLS.forEach((url, i) => {
  backendState[url] = { failCount: 0, lastFail: 0, latency: null };
});

function encodeBase64Utf8(text) {
  return Buffer.from(text || '', 'utf8').toString('base64');
}

function decodeBase64Utf8(text) {
  return Buffer.from(text || '', 'base64').toString('utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 获取当前可用后端（排除熔断中的）
 */
function getAvailableBackend() {
  const now = Date.now();
  for (const url of JUDGE0_URLS) {
    const state = backendState[url];
    if (state.failCount >= FAIL_THRESHOLD && now - state.lastFail < FAIL_COOLDOWN_MS) {
      continue;
    }
    return url;
  }
  // 所有后端都熔断，取冷却时间最短的
  const sorted = [...JUDGE0_URLS].sort((a, b) => backendState[a].lastFail - backendState[b].lastFail);
  backendState[sorted[0]].failCount = 0; // 强制重置
  return sorted[0];
}

function markBackendFailed(url) {
  const state = backendState[url];
  state.failCount++;
  state.lastFail = Date.now();
}

async function runCode(payload) {
  const url = getAvailableBackend();
  const start = Date.now();

  const response = await fetch(`${url}/submissions?base64_encoded=true&wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language_id: Number(payload.language_id) || 50,
      source_code: encodeBase64Utf8(payload.source_code),
      stdin: encodeBase64Utf8(payload.stdin || ''),
      cpu_time_limit: 5,
      memory_limit: 128000,
    }),
  });

  backendState[url].latency = Date.now() - start;

  if (!response.ok) {
    markBackendFailed(url);
    throw new Error(`Judge0 ${url} 返回 HTTP ${response.status}`);
  }

  const result = await response.json();
  const decodeField = (value) => (value ? decodeBase64Utf8(value) : '');

  return {
    stdout: decodeField(result.stdout),
    stderr: decodeField(result.stderr),
    compile_output: decodeField(result.compile_output),
    message: result.message || '',
    status: result.status || { id: 10, description: 'Internal Error' },
    time: result.time ?? null,
    memory: result.memory ?? null,
    _backend: url, // 用于调试
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (req.url === '/health') {
    return sendJson(res, 200, { ok: true, backends: JUDGE0_URLS.map(url => ({
      url,
      failCount: backendState[url].failCount,
      latency: backendState[url].latency,
    }))});
  }

  if (req.url === '/api/run' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body || '{}');
      const result = await runCode(payload);
      return sendJson(res, 200, result);
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  }

  const fileMap = {
    '/': 'index.html',
    '/app.js': 'app.js',
    '/style.css': 'style.css',
    '/README.md': 'README.md',
  };

  const fileName = fileMap[req.url];
  if (!fileName) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  const filePath = path.join(__dirname, fileName);
  const contentType = fileName.endsWith('.html')
    ? 'text/html; charset=utf-8'
    : fileName.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : fileName.endsWith('.md')
        ? 'text/plain; charset=utf-8'
        : 'application/javascript; charset=utf-8';

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`C Online Compiler backend listening on ${PORT}`);
  console.log(`Configured backends: ${JUDGE0_URLS.join(', ')}`);
});
