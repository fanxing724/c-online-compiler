// EdgeOne 边缘函数 - Judge0 CORS 代理
// 部署到 EdgeOne Functions，替换前端代理 URL

export default {
  async fetch(request, env) {
    // 只允许 GET 和 POST
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');

    if (!targetUrl) {
      return new Response('Missing url parameter', { status: 400 });
    }

    // 安全校验：只允许请求 judge0 域名
    try {
      const target = new URL(targetUrl);
      if (!target.hostname.endsWith('judge0.com')) {
        return new Response('Forbidden domain', { status: 403 });
      }
    } catch {
      return new Response('Invalid URL', { status: 400 });
    }

    // 构建请求头
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    
    // 转发请求到 Judge0
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: headers,
      body: request.method === 'POST' ? await request.text() : undefined,
    });

    // 返回结果，添加 CORS 头
    const corsHeaders = new Headers(response.headers);
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    return new Response(await response.text(), {
      status: response.status,
      headers: corsHeaders,
    });
  }
};
