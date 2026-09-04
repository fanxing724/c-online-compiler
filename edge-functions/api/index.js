// EdgeOne Edge Function - C Compiler API
// 路由: /api  接收前端代码提交，调用 Judge0 编译运行
const JUDGE0_URL = 'https://ce.judge0.com';
const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;
// 允许的语言 ID 白名单（当前仅 C，后续可扩展）
const ALLOWED_LANGUAGE_IDS = new Set([50]);

function encodeBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text || '');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64Utf8(text) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  );
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

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  const req = context && context.request ? context.request : context;

  if (!req) {
    return json({ error: 'Invalid request context' }, 500);
  }

  // CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 健康检查
  if (req.method === 'GET') {
    return json({ ok: true, service: 'c-compiler-api' });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    // 读取并限制请求体大小
    const bodyBuffer = await req.arrayBuffer();
    if (bodyBuffer.byteLength > MAX_BODY_BYTES) {
      return json({ error: `Request body too large (max ${MAX_BODY_BYTES / 1024}KB)` }, 413);
    }
    const bodyText = new TextDecoder().decode(bodyBuffer);
    if (!bodyText.trim()) {
      return json({ error: 'Empty request body' }, 400);
    }

    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    const sourceCode = typeof body.source_code === 'string' ? body.source_code : '';
    const stdin = typeof body.stdin === 'string' ? body.stdin : '';
    const languageId = Number(body.language_id) || 50;

    if (!sourceCode.trim()) {
      return json({ error: 'source_code is required' }, 400);
    }
    if (!ALLOWED_LANGUAGE_IDS.has(languageId)) {
      return json({ error: `Unsupported language_id: ${languageId}` }, 400);
    }

    // 调用 Judge0
    const judge0Response = await fetchWithTimeout(
      `${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language_id: languageId,
          source_code: encodeBase64Utf8(sourceCode),
          stdin: encodeBase64Utf8(stdin),
          cpu_time_limit: 5,
          memory_limit: 128000,
        }),
      },
      FETCH_TIMEOUT_MS
    );

    if (!judge0Response.ok && judge0Response.status !== 200) {
      const errText = await judge0Response.text().catch(() => '');
      return json(
        { error: `Judge0 upstream error (HTTP ${judge0Response.status})`, detail: errText.substring(0, 500) },
        502
      );
    }

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

    return json(output, 200);
  } catch (error) {
    if (error.name === 'AbortError') {
      return json({ error: 'Judge0 upstream timeout' }, 504);
    }
    return json({ error: 'Internal server error' }, 500);
  }
}
