const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const JUDGE0_URL = process.env.JUDGE0_URL || 'https://ce.judge0.com';

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

async function runCode(payload) {
  const response = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
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
    return sendJson(res, 200, { ok: true });
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
      : 'application/javascript; charset=utf-8';

  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`C Online Compiler backend listening on ${PORT}`);
});
