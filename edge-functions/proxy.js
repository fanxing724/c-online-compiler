// EdgeOne Edge Function - Judge0 CORS 代理（备用）
// 路由: /proxy  主路径使用 /api，此文件为兼容回退
const FETCH_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 64 * 1024;

function isAllowedDomain(hostname) {
  return hostname === 'ce.judge0.com' || hostname.endsWith('.judge0.com');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

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
  const request = context && context.request ? context.request : context;

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400, headers: CORS_HEADERS });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL', { status: 400, headers: CORS_HEADERS });
    }

    // 仅允许 https 协议
    if (target.protocol !== 'https:') {
      return new Response('Only https targets allowed', { status: 403, headers: CORS_HEADERS });
    }

    if (!isAllowedDomain(target.hostname)) {
      return new Response('Forbidden domain', { status: 403, headers: CORS_HEADERS });
    }

    // 读取请求体并限制大小
    let body = undefined;
    if (request.method === 'POST') {
      const bodyBuffer = await request.arrayBuffer();
      if (bodyBuffer.byteLength > MAX_BODY_BYTES) {
        return new Response(`Request body too large (max ${MAX_BODY_BYTES / 1024}KB)`, {
          status: 413,
          headers: CORS_HEADERS,
        });
      }
      body = bodyBuffer;
    }

    // 转发请求（保留 Content-Type，其他头由上游处理）
    const response = await fetchWithTimeout(
      target.toString(),
      {
        method: request.method,
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      FETCH_TIMEOUT_MS
    );

    // 构建响应头，注入 CORS
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      return new Response('Upstream timeout', { status: 504, headers: CORS_HEADERS });
    }
    return new Response(`Proxy Error: ${error.message}`, {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
