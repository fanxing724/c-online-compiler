import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, execute, LIMITS, readLimited } from '../edge-functions/_lib/compiler.js';
import { createServer } from '../server.js';
import { onRequest } from '../edge-functions/api/index.js';
const encode = text => Buffer.from(text).toString('base64');
const payload = { source_code: 'int main(void) { return 0; }', stdin: '你好，C！', language_id: 50 };
const accepted = { status: { id: 3, description: 'Accepted' }, stdout: encode('你好，C！\n'), time: '0.1', memory: 1234 };
const req = (body = payload, options = {}) => new Request('https://example.com/api', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), ...options,
});
const reply = data => new Response(JSON.stringify(data));
test('Unicode source/input remain intact and Judge0 execution options are fixed', async () => {
    const result = await execute(payload, {}, { fetch: async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(Buffer.from(body.stdin, 'base64').toString(), payload.stdin);
        assert.equal(Buffer.from(body.source_code, 'base64').toString(), payload.source_code);
        assert.equal(body.language_id, 50);
        assert.equal(body.enable_network, false);
        assert.equal(body.cpu_time_limit, 5);
        assert.match(url, /base64_encoded=true&wait=false$/);
        return reply({ ...accepted, message: encode('详细信息') });
    } });
    assert.equal(result.stdout, '你好，C！\n');
    assert.equal(result.message, '详细信息');
});
test('asynchronous token polling survives queued responses without a repeated token', async () => {
    let calls = 0;
    const result = await execute(payload, {}, { fetch: async (url, options) => {
        calls++;
        if (calls === 1) return reply({ token: 'task-123' });
        assert.match(url, /\/submissions\/task-123\?base64_encoded=true$/);
        assert.equal(options.method, 'GET');
        return reply(calls === 2 ? { status: { id: 2 } } : accepted);
    } });
    assert.equal(calls, 3);
    assert.equal(result.status.id, 3);
});
for (const [name, body, expected] of [
    ['empty code', { ...payload, source_code: '  ' }, 400],
    ['non-C language', { ...payload, language_id: 91 }, 400],
    ['string language id', { ...payload, language_id: '50' }, 400],
    ['invalid stdin', { ...payload, stdin: 5 }, 400],
    ['UTF-8 byte limit', { ...payload, source_code: '汉'.repeat(11000) }, 413],
    ['stdin limit', { ...payload, stdin: 'x'.repeat(LIMITS.stdin + 1) }, 413],
    ['body limit', ' '.repeat(LIMITS.body + 1), 413],
    ['broken JSON', '{', 400],
    ['null body', null, 400],
]) test(`rejects ${name} before upstream submission`, async () => {
    const handle = createHandler({ fetch: () => assert.fail('must not submit') });
    assert.equal((await handle(req(body))).status, expected);
});
test('methods, same-origin policy and health response', async () => {
    const handle = createHandler();
    assert.equal((await handle(req(payload, { headers: { Origin: 'https://other.example', 'Content-Type': 'application/json' } }))).status, 403);
    const options = await handle(new Request('https://example.com/api', { method: 'OPTIONS' }));
    assert.equal(options.status, 405);
    assert.equal(options.headers.get('Allow'), 'GET, POST');
    assert.equal(options.headers.get('Access-Control-Allow-Origin'), null);
    const health = await onRequest({ request: new Request('https://example.com/api'), env: { JUDGE0_AUTH_TOKEN: 'hidden-value' } });
    assert.equal(health.headers.get('Cache-Control'), 'no-store');
    assert.equal((await health.json()).service, 'c-compiler-api');
    assert.equal((await handle(req(payload, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
});
test('stream limit applies even without Content-Length', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(100)); controller.close(); } });
    await assert.rejects(readLimited(stream, 99), { status: 413 });
});
test('upstream HTTP, invalid JSON, malformed results and base64 produce safe failures', async () => {
    for (const response of [new Response('secret', { status: 500 }), new Response('bad json'), reply({ token: '../escape' }), reply({ status: { id: 99 } }), reply({ ...accepted, stdout: '!!' }), reply(null)]) {
        const handle = createHandler({ fetch: async () => response });
        const result = await handle(req());
        assert.equal(result.status, 502);
        assert.doesNotMatch(await result.text(), /secret/);
    }
    assert.equal((await createHandler({ fetch: async () => new Response('', { status: 429 }) })(req())).status, 429);
});
test('timeout and caller cancellation abort upstream', async () => {
    const pending = (_, options) => new Promise((resolve, reject) => {
        if (options.signal.aborted) return reject(new Error('aborted'));
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    await assert.rejects(execute(payload, {}, { fetch: pending, timeoutMs: 20 }), { status: 504 });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(execute(payload, {}, { fetch: pending, signal: controller.signal }), { status: 504 });
});
test('configured credentials stay server-side and redirects are refused', async () => {
    const result = await execute(payload, { JUDGE0_URL: 'https://judge.example/v1/', JUDGE0_AUTH_TOKEN: 'local-test-token' }, { fetch: async (url, options) => {
        assert.match(url, /^https:\/\/judge.example\/v1\/submissions/);
        assert.equal(options.headers['X-Auth-Token'], 'local-test-token');
        assert.equal(options.redirect, 'error');
        return reply(accepted);
    } });
    assert.doesNotMatch(JSON.stringify(result), /local-test-token/);
    await assert.rejects(execute(payload, { JUDGE0_URL: 'http://judge.example' }), { status: 503 });
});
test('quota limits repeat submissions without extra upstream calls', async () => {
    const handle = createHandler({ fetch: async () => reply(accepted) });
    for (let i = 0; i < 10; i++) assert.equal((await handle(req(), {}, 'client-a')).status, 200);
    assert.equal((await handle(req(), {}, 'client-a')).status, 429);
    assert.equal((await handle(req(), {}, 'client-b')).status, 200);
});
test('bounded concurrency releases slots after completion', async () => {
    const releases = [];
    const handle = createHandler({ fetch: () => new Promise(resolve => releases.push(() => resolve(reply(accepted)))) });
    const pending = Array.from({ length: 4 }, () => handle(req()));
    while (releases.length < 4) await new Promise(resolve => setImmediate(resolve));
    assert.equal((await handle(req())).status, 503);
    releases.forEach(release => release());
    assert.deepEqual((await Promise.all(pending)).map(r => r.status), [200, 200, 200, 200]);
});
test('Node adapter serves assets, hides source/config, and uses the shared API', async t => {
    const server = createServer({}, { fetch: async () => reply(accepted) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.match(await (await fetch(base)).text(), /番星C语言编辑器/);
    assert.equal((await fetch(base + '/style.css', { method: 'HEAD' })).status, 200);
    for (const path of ['/.env', '/server.js', '/.git/config', '/README.md']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await (await fetch(base + '/health')).json()).ok, true);
    const result = await fetch(base + '/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal((await result.json()).stdout, '你好，C！\n');
});

// EdgeOne documents stream chunks as string | ArrayBuffer | ArrayBufferView.
// https://cloud.tencent.com/document/product/1552/81924
const streamChunks = chunks => new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk);
    controller.close();
} });
for (const [name, convert] of [
    ['ArrayBuffer', bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)],
    ['Uint8Array subview', bytes => { const padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 3); return padded.subarray(3, 3 + bytes.length); }],
    ['DataView subview', bytes => { const padded = new Uint8Array(bytes.length + 8); padded.set(bytes, 3); return new DataView(padded.buffer, 3, bytes.length); }],
]) test(`EdgeOne ${name} chunks retain UTF-8 across chunk boundaries`, async () => {
    const text = JSON.stringify({ source_code: '你好，C！🙂', stdin: '中文输入' });
    const bytes = new TextEncoder().encode(text);
    const chunks = Array.from(bytes, byte => convert(new Uint8Array([byte])));
    assert.equal(await readLimited(streamChunks(chunks), bytes.length), text);
    await assert.rejects(readLimited(streamChunks(chunks), bytes.length - 1), { status: 413 });
});
test('EdgeOne string chunks count UTF-8 bytes rather than characters', async () => {
    assert.equal(await readLimited(streamChunks(['你', '好']), 6), '你好');
    await assert.rejects(readLimited(streamChunks(['你', '好']), 5), { status: 413 });
});
test('EdgeOne mixed chunks work throughout request and upstream response handling', async () => {
    const source = 'int main(void) { /* 你好，C！ */ return 0; }';
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, source_code: source }));
    const request = {
        url: 'https://example.com/api', method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        signal: new AbortController().signal,
        body: streamChunks([bytes.slice(0, 10).buffer, new DataView(bytes.slice(10).buffer)]),
    };
    const handle = createHandler({ fetch: async (_, options) => {
        assert.equal(Buffer.from(JSON.parse(options.body).source_code, 'base64').toString(), source);
        const data = new TextEncoder().encode(JSON.stringify(accepted));
        return { ok: true, body: streamChunks(['{', data.slice(1, 30).buffer, new DataView(data.slice(30).buffer)]) };
    } });
    const response = await handle(request);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).stdout, '你好，C！\n');
});
