import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { createHandler } from './edge-functions/_lib/compiler.js';

export function createServer(env = process.env, options = {}) {
    const handle = createHandler(options);
    const files = {
        '/': ['index.html', 'text/html; charset=utf-8'],
        '/index.html': ['index.html', 'text/html; charset=utf-8'],
        '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
        '/style.css': ['style.css', 'text/css; charset=utf-8'],
        '/assets/background.png': ['assets/background.png', 'image/png'],
    };
    return http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, async (req, res) => {
        try {
            const origin = `http://${req.headers.host || 'localhost'}`;
            const pathname = new URL(req.url, origin).pathname;
            if (['/api', '/api/', '/api/run', '/health'].includes(pathname)) {
                const controller = new AbortController();
                req.on('aborted', () => controller.abort());
                res.on('close', () => { if (!res.writableEnded) controller.abort(); });
                const request = new Request(new URL(req.url, origin), {
                    method: req.method, headers: req.headers, signal: controller.signal,
                    ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}),
                });
                const response = await handle(request, env, req.socket.remoteAddress || 'local');
                res.writeHead(response.status, Object.fromEntries(response.headers));
                return res.end(await response.text());
            }
            const file = files[pathname];
            if (!file) { res.writeHead(404); return res.end('Not found'); }
            if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }
            const contents = await readFile(new URL(file[0], import.meta.url));
            res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff' });
            res.end(req.method === 'HEAD' ? undefined : contents);
        } catch {
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '服务暂不可用' }));
        }
    });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '127.0.0.1';
    const server = createServer();
    server.on('error', error => { console.error(`启动失败：${error.code}`); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`番星C语言编辑器：http://${host}:${port}`));
}
