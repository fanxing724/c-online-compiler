// C online compiler, maintained by fanxing724. Licensed under AFL-3.0.
const STORAGE_KEY = 'fanxing_c_compiler_v1';
const encoder = new TextEncoder();
const EXAMPLES = {
    hello: { code: `#include <stdio.h>

int main(void) {
    puts("Hello, World!");
    puts("你好，C！");
    return 0;
}`, stdin: '' },
    sum: { code: `#include <stdio.h>

int main(void) {
    long long a, b;
    if (scanf("%lld %lld", &a, &b) == 2) {
        printf("%lld\\n", a + b);
    }
    return 0;
}`, stdin: '12 30' },
    sort: { code: `#include <stdio.h>
#include <stdlib.h>

int compare(const void *a, const void *b) {
    int x = *(const int *)a, y = *(const int *)b;
    return (x > y) - (x < y);
}

int main(void) {
    int n, numbers[100];
    if (scanf("%d", &n) != 1 || n < 0 || n > 100) return 1;
    for (int i = 0; i < n; i++) {
        if (scanf("%d", &numbers[i]) != 1) return 1;
    }
    qsort(numbers, n, sizeof(int), compare);
    for (int i = 0; i < n; i++) {
        if (i > 0) putchar(' ');
        printf("%d", numbers[i]);
    }
    putchar('\\n');
    return 0;
}`, stdin: '5\n9 1 7 3 5' },
};
const $ = id => document.getElementById(id);
const codeArea = $('codeEditor');
// Keep editing usable if the third-party CodeMirror CDN is unavailable.
const editor = window.CodeMirror ? CodeMirror.fromTextArea(codeArea, {
    mode: 'text/x-csrc', theme: 'dracula', lineNumbers: true,
    autoCloseBrackets: true, matchBrackets: true, indentUnit: 4,
    tabSize: 4, indentWithTabs: false, lineWrapping: true,
}) : {
    getValue: () => codeArea.value,
    setValue: value => { codeArea.value = value; },
    on: (_, listener) => codeArea.addEventListener('input', listener),
    setOption: () => {},
};
let saved;
try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) {
        const legacy = localStorage.getItem('fanxing_c_compiler_code');
        if (legacy !== null) saved = { code: legacy, stdin: '', language: 50 };
    }
} catch { /* Storage can be disabled. */ }
editor.setValue(typeof saved?.code === 'string' ? saved.code : EXAMPLES.hello.code);
$('stdinInput').value = typeof saved?.stdin === 'string' ? saved.stdin : '';
$('languageSelect').value = [50].includes(saved?.language) ? saved.language : 50;
let storageFailed = false;
function save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            code: editor.getValue(), stdin: $('stdinInput').value,
            language: Number($('languageSelect').value),
        }));
    } catch {
        storageFailed = true;
        $('saveStatus').textContent = '浏览器禁止存储，刷新前请下载代码';
    }
    if (!storageFailed) $('saveStatus').textContent = '已保存到当前浏览器';
}
editor.on('change', save);
$('stdinInput').addEventListener('input', save);
$('languageSelect').addEventListener('change', save);
window.addEventListener('pagehide', save);

const STATUS = {
    1: '等待中', 2: '处理中', 3: '运行成功', 4: '答案不匹配',
    5: '运行超时', 6: '编译错误', 7: '运行错误（SIGSEGV）',
    8: '输出文件超限（SIGXFSZ）', 9: '运行错误（SIGFPE）',
    10: '运行错误（SIGABRT）', 11: '运行错误（非零退出）',
    12: '运行错误', 13: '编译服务内部错误', 14: '可执行文件格式错误',
};
function status(id) {
    $('statusBadge').className = `status-badge ${id === 1 || id === 2 ? 'running' : id === 3 ? 'success' : 'error'}`;
    $('statusBadge').textContent = STATUS[id] || '请求失败';
}
function output(text, error = false) {
    $('output').textContent = text;
    $('output').style.color = error ? 'var(--error-color)' : 'var(--text-primary)';
}
async function api(options, timeout = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch('/api', { ...options, signal: controller.signal });
        let data;
        try { data = await response.json(); }
        catch { throw new Error('编译接口未就绪，请使用 npm start 或部署到 EdgeOne Pages'); }
        if (!response.ok) throw new Error(data.error || `编译请求失败（HTTP ${response.status}）`);
        return data;
    } finally { clearTimeout(timer); }
}
async function checkService() {
    try {
        const data = await api({ method: 'GET' }, 5000);
        if (!data.ok || data.service !== 'c-compiler-api') throw new Error('编译接口不匹配');
        $('deployStatus').className = 'backend-status healthy';
        $('deployStatus').textContent = '编译接口已连接 · 实际运行取决于上游编译服务';
    } catch (error) {
        $('deployStatus').className = 'backend-status error';
        $('deployStatus').textContent = error.name === 'AbortError' ? '编译接口连接超时' : error.message;
    }
}
checkService();
let isRunning = false;
let lastSubmit = 0;
async function runCode() {
    if (isRunning) return;
    const code = editor.getValue();
    const stdin = $('stdinInput').value;
    if (!code.trim()) return output('请输入 C 源代码', true);
    if (encoder.encode(code).length > 32768) return output('代码不能超过 32KB（UTF-8）', true);
    if (encoder.encode(stdin).length > 16384) return output('标准输入不能超过 16KB（UTF-8）', true);
    if (Date.now() - lastSubmit < 3000) return output('请等待 3 秒再提交', true);
    isRunning = true;
    lastSubmit = Date.now();
    $('runBtn').disabled = true;
    $('runBtnLabel').textContent = '编译中...';
    status(2);
    output('正在编译运行...');
    save();
    const started = performance.now();
    try {
        const result = await api({ method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_code: code, stdin, language_id: Number($('languageSelect').value) }),
        });
        if (!Number.isInteger(result.status?.id) || result.status.id < 3 || result.status.id > 14) {
            throw new Error('编译服务返回了无效结果');
        }
        status(result.status.id);
        const parts = [];
        if (result.compile_output) parts.push(`[编译输出]\n${result.compile_output}`);
        if (result.stdout) parts.push(`[输出]\n${result.stdout}`);
        if (result.stderr) parts.push(`[错误]\n${result.stderr}`);
        if (result.message) parts.push(`[信息]\n${result.message}`);
        if (!parts.length) parts.push(result.status.id === 3 ? '程序运行成功，无输出' : STATUS[result.status.id]);
        const stats = [`请求耗时 ${Math.round(performance.now() - started)}ms`];
        if (result.time !== null && result.time !== undefined) stats.push(`运行 ${result.time}s`);
        if (result.memory !== null && result.memory !== undefined) stats.push(`内存 ${result.memory}KB`);
        parts.push(stats.join(' · '));
        output(parts.join('\n\n'), result.status.id !== 3);
    } catch (error) {
        status(0);
        output(error.name === 'AbortError' ? '请求超时，请稍后重试' : error.message, true);
    } finally {
        isRunning = false;
        $('runBtn').disabled = false;
        $('runBtnLabel').textContent = '编译运行';
    }
}
function resetOutput() {
    output('点击“编译运行”查看结果...');
    $('statusBadge').className = 'status-badge hidden';
}
function replaceCode(code, stdin) {
    editor.setValue(code);
    $('stdinInput').value = stdin;
    resetOutput();
    save();
}
$('exampleSelect').addEventListener('change', event => {
    const example = EXAMPLES[event.target.value];
    if (example && (editor.getValue() === EXAMPLES.hello.code || confirm('载入示例将替换当前代码和输入，是否继续？'))) {
        replaceCode(example.code, example.stdin);
    }
    event.target.value = '';
});
function downloadCode() {
    const blob = new Blob([editor.getValue()], { type: 'text/x-csrc;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'main.c';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('runBtn').addEventListener('click', runCode);
$('downloadBtn').addEventListener('click', downloadCode);
$('clearBtn').addEventListener('click', () => { if (confirm('清空当前代码和标准输入？')) replaceCode('', ''); });
$('resetBtn').addEventListener('click', () => { if (confirm('恢复 Hello World 模板？当前代码和输入将被替换。')) replaceCode(EXAMPLES.hello.code, ''); });
editor.setOption('extraKeys', {
    'Ctrl-Enter': runCode, 'Cmd-Enter': runCode,
    'Ctrl-S': downloadCode, 'Cmd-S': downloadCode,
    'Tab': cm => cm.replaceSelection('    '),
});
if (!window.CodeMirror) codeArea.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey) {
        if (event.key === 'Enter') { event.preventDefault(); runCode(); }
        if (event.key.toLowerCase() === 's') { event.preventDefault(); downloadCode(); }
    }
});
