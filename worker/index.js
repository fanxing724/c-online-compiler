// Cloudflare Worker - Judge0 CORS 代理
// 部署到 https://workers.cloudflare.com

const JUDGE0_BASE = 'https://ce.judge0.com';
const ALLOWED_ORIGINS = ['*']; // 生产环境建议限制域名

export default {
  async fetch(request) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    // 只允许 GET 和 POST
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      // 获取请求路径和参数
      const url = new URL(request.url);
      const path = url.pathname.replace(/^\/proxy/, '');
      const queryString = url.search;
      
      // 构建 Judge0 目标 URL
      const targetUrl = `${JUDGE0_BASE}${path}${queryString}`;
      
      console.log(`Proxying to: ${targetUrl}`);

      // 构建请求头
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');

      // 转发请求
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: headers,
        body: request.method === 'POST' ? await request.text() : undefined,
      });

      // 返回结果 + CORS 头
      const corsHeaders = new Headers(response.headers);
      corsHeaders.set('Access-Control-Allow-Origin', '*');
      corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      corsHeaders.set('Access-Control-Allow-Headers', 'Content-Type');

      return new Response(await response.text(), {
        status: response.status,
        headers: corsHeaders,
      });

    } catch (err) {
      console.error('Proxy error:', err);
      return new Response(`Proxy Error: ${err.message}`, { 
        status: 500,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }
  }
};
