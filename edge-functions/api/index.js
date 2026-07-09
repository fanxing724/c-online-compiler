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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json; charset=utf-8',
};

export default async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const body = await request.json();
    const sourceCode = body.source_code || '';
    const stdin = body.stdin || '';
    const languageId = Number(body.language_id) || 50;

    const response = await fetch(`${JUDGE0_URL}/submissions?base64_encoded=true&wait=true`, {
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

    const result = await response.json();

    const output = {
      stdout: result.stdout ? decodeBase64Utf8(result.stdout) : '',
      stderr: result.stderr ? decodeBase64Utf8(result.stderr) : '',
      compile_output: result.compile_output ? decodeBase64Utf8(result.compile_output) : '',
      message: result.message || '',
      status: result.status || { id: 10, description: 'Internal Error' },
      time: result.time ?? null,
      memory: result.memory ?? null,
    };

    return new Response(JSON.stringify(output), {
      status: response.ok ? 200 : response.status,
      headers: CORS_HEADERS,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
