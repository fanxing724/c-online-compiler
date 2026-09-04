// EdgeOne 边缘函数 - Judge0 CORS 代理（备用）
// 部署到 EdgeOne Functions，主路径使用 /api（edge-functions/api/index.js）

export default async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    let target;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    if (target.hostname !== 'ce.judge0.com' && !target.hostname.endsWith('.judge0.com')) {
      return new Response('Forbidden domain', { status: 403 });
    }

    const response = await fetch(target.toString(), {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');

    return new Response(await response.text(), {
      status: response.status,
      headers,
    });
  } catch (error) {
    return new Response(`Proxy Error: ${error.message}`, {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  }
}
