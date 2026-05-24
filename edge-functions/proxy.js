export async function onRequest(context) {
  const request = context.request;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders(),
    });
  }

  if (request.method !== 'GET' && request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders(),
    });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response('Missing url parameter', {
      status: 400,
      headers: corsHeaders(),
    });
  }

  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return new Response('Invalid URL', {
      status: 400,
      headers: corsHeaders(),
    });
  }

  if (target.hostname !== 'ce.judge0.com' && !target.hostname.endsWith('.judge0.com')) {
    return new Response('Forbidden domain', {
      status: 403,
      headers: corsHeaders(),
    });
  }

  const response = await fetch(target.toString(), {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: request.method === 'POST' ? await request.text() : undefined,
  });

  const headers = new Headers(response.headers);
  applyCors(headers);

  return new Response(await response.text(), {
    status: response.status,
    headers,
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function applyCors(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
}
