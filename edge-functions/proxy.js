// Legacy endpoint; all compilation now uses the validated same-origin /api.
export function onRequest() {
    return new Response(JSON.stringify({ error: '旧代理接口已停用，请刷新页面后通过 /api 编译运行' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
export default onRequest;
