// C online compiler, maintained by fanxing724. Licensed under AFL-3.0.
export const LANGUAGES = [
    { id: 50, name: 'C (GCC 9.2.0)' },
];
export const LIMITS = { body: 96 * 1024, code: 32 * 1024, stdin: 16 * 1024 };
const encoder = new TextEncoder();
export class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    } });
}
export async function readLimited(stream, maxBytes) {
    if (!stream) return '';
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            // EdgeOne also returns ArrayBuffer/string chunks. Uint8Array.set()
            // cannot copy raw ArrayBuffers or DataViews directly.
            let chunk;
            if (typeof value === 'string') chunk = encoder.encode(value);
            else if (ArrayBuffer.isView(value)) chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            else if (value instanceof ArrayBuffer) chunk = new Uint8Array(value);
            else throw new TypeError('Unsupported stream chunk');
            size += chunk.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                throw new ApiError(413, '数据超过大小限制');
            }
            chunks.push(chunk);
        }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
}
export function validatePayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, '请求必须是 JSON 对象');
    if (typeof body.source_code !== 'string' || !body.source_code.trim()) throw new ApiError(400, '请输入 C 源代码');
    if (encoder.encode(body.source_code).length > LIMITS.code) throw new ApiError(413, '代码不能超过 32KB（UTF-8）');
    if (body.stdin !== undefined && typeof body.stdin !== 'string') throw new ApiError(400, '标准输入必须是字符串');
    const stdin = body.stdin ?? '';
    if (encoder.encode(stdin).length > LIMITS.stdin) throw new ApiError(413, '标准输入不能超过 16KB（UTF-8）');
    const languageId = body.language_id ?? 50;
    if (!LANGUAGES.some(lang => lang.id === languageId)) throw new ApiError(400, '仅支持 C（GCC 9.2.0）');
    return { source_code: body.source_code, stdin, language_id: languageId };
}
function encode(text) {
    const bytes = encoder.encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}
function decode(text) {
    return text ? new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0))) : '';
}
function envValue(env, name) { return String(env[name] ?? globalThis[name] ?? '').trim(); }
export async function execute(payload, env = {}, options = {}) {
    const base = envValue(env, 'JUDGE0_URL') || 'https://ce.judge0.com';
    let url;
    try { url = new URL(base); } catch { throw new ApiError(503, '编译服务地址配置错误'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new ApiError(503, '编译服务地址必须为 HTTPS');
    const headers = { 'Content-Type': 'application/json' };
    const token = envValue(env, 'JUDGE0_AUTH_TOKEN');
    if (token) headers['X-Auth-Token'] = token;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 25000);
    const parentSignal = options.signal;
    const abort = () => controller.abort();
    parentSignal?.addEventListener('abort', abort, { once: true });
    if (parentSignal?.aborted) controller.abort();
    const upstreamFetch = options.fetch || fetch;
    async function request(path, method, body) {
        const response = await upstreamFetch(`${base.replace(/\/$/, '')}${path}`, {
            method, headers, body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal, redirect: 'error',
        });
        if (!response.ok) {
            await response.body?.cancel();
            throw new ApiError(response.status === 429 ? 429 : 502, response.status === 429
                ? '编译服务请求过多，请稍后重试' : `编译服务暂不可用（HTTP ${response.status}）`);
        }
        try { return JSON.parse(await readLimited(response.body, 1024 * 1024)); }
        catch (error) {
            if (controller.signal.aborted) throw error;
            throw new ApiError(502, '编译服务返回了无效数据');
        }
    }
    try {
        let result = await request('/submissions?base64_encoded=true&wait=false', 'POST', {
            language_id: payload.language_id,
            source_code: encode(payload.source_code), stdin: encode(payload.stdin),
            cpu_time_limit: 5, wall_time_limit: 10, memory_limit: 128000,
            max_file_size: 1024, enable_network: false,
        });
        // Polling also works on Judge0 instances that disable wait=true.
        while (!result.status || result.status.id <= 2) {
            if (!/^[a-zA-Z0-9-]{1,80}$/.test(result.token || '')) throw new ApiError(502, '编译服务缺少有效任务编号');
            const submissionToken = result.token;
            await new Promise((resolve, reject) => {
                if (controller.signal.aborted) return reject(new ApiError(504, '编译服务响应超时，请稍后重试'));
                const onAbort = () => { clearTimeout(wait); reject(new ApiError(504, '编译服务响应超时，请稍后重试')); };
                const wait = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, 500);
                controller.signal.addEventListener('abort', onAbort, { once: true });
            });
            result = await request(`/submissions/${submissionToken}?base64_encoded=true`, 'GET');
            result.token ||= submissionToken;
        }
        if (!Number.isInteger(result.status.id) || result.status.id < 3 || result.status.id > 14) throw new ApiError(502, '编译服务返回了无效状态');
        try {
            return {
                stdout: decode(result.stdout), stderr: decode(result.stderr),
                compile_output: decode(result.compile_output), message: decode(result.message),
                status: result.status, time: result.time ?? null, memory: result.memory ?? null,
            };
        } catch { throw new ApiError(502, '编译输出解码失败'); }
    } catch (error) {
        if (controller.signal.aborted) throw new ApiError(504, '编译服务响应超时，请稍后重试');
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, '无法连接编译服务，请稍后重试');
    } finally {
        clearTimeout(timer);
        parentSignal?.removeEventListener('abort', abort);
    }
}
export function createHandler(options = {}) {
    // Per-process / per-edge-isolate protection; use platform WAF for a global policy.
    const clients = new Map();
    let active = 0;
    return async (request, env = {}, clientId = 'edge') => {
        try {
            const origin = request.headers.get('Origin');
            if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, '仅允许本站调用');
            if (request.method === 'GET') return json({ ok: true, service: 'c-compiler-api', version: '1.0.0', languages: LANGUAGES });
            if (request.method !== 'POST') {
                const response = json({ error: '仅支持 GET 和 POST' }, 405);
                response.headers.set('Allow', 'GET, POST');
                return response;
            }
            if (new URL(request.url).pathname === '/health') throw new ApiError(405, '健康检查仅支持 GET');
            if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new ApiError(415, '请使用 application/json');
            if (Number(request.headers.get('Content-Length')) > LIMITS.body) throw new ApiError(413, '请求体不能超过 96KB');
            const text = await readLimited(request.body, LIMITS.body);
            let body;
            try { body = JSON.parse(text); } catch { throw new ApiError(400, 'JSON 格式错误'); }
            const payload = validatePayload(body);
            const now = Date.now();
            for (const [id, value] of clients) if (value.expires <= now) clients.delete(id);
            const key = request.eo?.clientIp || clientId;
            const quota = clients.get(key) || { count: 0, expires: now + 60000 };
            if (quota.count >= 10 || (!clients.has(key) && clients.size >= 1000)) throw new ApiError(429, '请求太频繁，请稍后重试');
            if (active >= 4) throw new ApiError(503, '编译队列已满，请稍后重试');
            quota.count++;
            clients.set(key, quota);
            active++;
            try { return json(await execute(payload, env, { ...options, signal: request.signal })); }
            finally { active--; }
        } catch (error) {
            return json({ error: error instanceof ApiError ? error.message : '服务暂不可用' }, error.status || 500);
        }
    };
}
