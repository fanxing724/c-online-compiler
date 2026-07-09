// EdgeOne Makers Edge Function - C Compiler API
// 自动映射为 /api 路由，接收前端代码提交，调用 Judge0 编译运行

const JUDGE0_URL = 'https://ce.judge0.com';

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text || '');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(text) {
  return new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

export default async function onRequest(context) {
  const req = context instanceof Request ? context : context.request;

  if (!req) {
    return json({ error: 'No request found in context', keys: Object.keys(context || {}) }, 500);
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method === 'GET') {
    return json({ ok: true, service: 'c-compiler-api', timestamp: Date.now() });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const bodyText = await req.text();
    const body = JSON.parse(bodyText);
    const sourceCode = body.source_code || '';
    const stdin = body.stdin || '';
    const languageId = Number(body.language_id) || 50;

    const judge0Response = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language_id: languageId,
        source_code: encodeBase64Utf8(sourceCode),
        stdin: encodeBase64Utf8(stdin),
        cpu_time_limit: 5,
        memory_limit: 128000,
      }),
    });

    const result = await judge0Response.json();

    const output = {
      stdout: result.stdout ? decodeBase64Utf8(result.stdout) : '',
      stderr: result.stderr ? decodeBase64Utf8(result.stderr) : '',
      compile_output: result.compile_output ? decodeBase64Utf8(result.compile_output) : '',
      message: result.message || '',
      status: result.status || { id: 10, description: 'Internal Error' },
      time: result.time ?? null,
      memory: result.memory ?? null,
    };

    return json(output, judge0Response.ok ? 200 : judge0Response.status);
  } catch (error) {
    return json({ error: error.message, stack: error.stack }, 500);
  }
}
