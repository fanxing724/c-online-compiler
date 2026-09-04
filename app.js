// 番星 C 语言编辑器 - 前端主逻辑
const APP_CONFIG = window.__APP_CONFIG__ || {};
const EDGE_API_URL = APP_CONFIG.edgeApiUrl || '';
const JUDGE0_PROXY_URL = APP_CONFIG.judge0ProxyUrl || '';
const BACKEND_RUN_URL = APP_CONFIG.backendRunUrl || '';
const USE_PROXY = APP_CONFIG.useProxy !== false && Boolean(JUDGE0_PROXY_URL);

const C_LANGUAGE_ID = 50;
const COOLDOWN_MS = 3000;
const MAX_CODE_LENGTH = 32768;
const REQUEST_TIMEOUT_MS = 20000;
const STORAGE_KEY = 'fanxing_c_compiler_code';
const STORAGE_VERSION = 3;

// 默认 C 代码模板
const DEFAULT_CODE = `#include <stdio.h>
int main() {
    puts("Hello, World!");
    return 0;
}`;

// ============ CodeMirror 初始化 ============
const editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    mode: 'text/x-csrc',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
});

// localStorage 版本迁移 + 非法字符检测
const savedVersion = localStorage.getItem(STORAGE_KEY + '_version');
if (savedVersion !== String(STORAGE_VERSION)) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY + '_version', STORAGE_VERSION);
}
const savedCode = localStorage.getItem(STORAGE_KEY);
const hasBadChars = savedCode && /[\u201c\u201d\u2018\u2019]/.test(savedCode);
if (hasBadChars) {
    localStorage.removeItem(STORAGE_KEY);
}
editor.setValue(savedCode && savedCode.trim() && !hasBadChars ? savedCode : DEFAULT_CODE);

// 自动保存（1秒防抖）
let saveTimer = null;
editor.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, editor.getValue());
    }, 1000);
});

// ============ DOM 元素 ============
const runBtn = document.getElementById('runBtn');
const runBtnLabel = document.getElementById('runBtnLabel');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const outputEl = document.getElementById('output');
const statusBadge = document.getElementById('statusBadge');
const stdinInput = document.getElementById('stdinInput');
const appVersion = document.getElementById('appVersion');
const deployStatusEl = document.getElementById('deployStatus');

if (appVersion) {
    appVersion.textContent = APP_CONFIG.version || 'dev';
}

// ============ 部署状态检测 ============
async function checkDeployment() {
    if (!deployStatusEl) return;
    const checks = [`JS: ${APP_CONFIG.version || 'dev'}`];
    if (EDGE_API_URL) {
        try {
            const res = await fetchWithTimeout(EDGE_API_URL, { method: 'GET' }, 5000);
            const data = await res.json();
            checks.push(data.ok ? '/api: 正常' : `/api: 异常 (${res.status})`);
            deployStatusEl.className = 'backend-status ' + (data.ok ? 'healthy' : 'error');
        } catch (e) {
            checks.push(`/api: 失败 (${e.name === 'AbortError' ? '超时' : e.message})`);
            deployStatusEl.className = 'backend-status error';
        }
    } else {
        checks.push('/api: 未配置');
        deployStatusEl.className = 'backend-status error';
    }
    deployStatusEl.textContent = checks.join(' | ');
}
checkDeployment();

// ============ 工具函数 ============
function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function toBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

function fromBase64Utf8(text) {
    return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
}

/**
 * 提交前清理代码：中文标点替换为英文对应字符
 * 弯引号替换为直引号（而非删除），避免破坏代码语义
 */
function sanitizeCode(code) {
    return code
        .replace(/[\u201c\u201d\uff02\u300c\u300d]/g, '"')
        .replace(/[\u2018\u2019\u300e\u300f]/g, "'")
        .replace(/\u300a/g, '[')
        .replace(/\u300b/g, ']')
        .replace(/\u2014/g, '--')
        .replace(/\u2013/g, '-')
        .replace(/\uff01/g, '!')
        .replace(/\uff08/g, '(')
        .replace(/\uff09/g, ')')
        .replace(/\uff0c/g, ',')
        .replace(/\u3002/g, '.')
        .replace(/\uff1a/g, ':')
        .replace(/\uff1b/g, ';')
        .replace(/\uff1f/g, '?')
        .replace(/\uff5e/g, '~')
        .replace(/\uffe5/g, '$');
}

// 状态映射
const STATUS_MAP = {
    1: { text: '等待中', class: 'running' },
    2: { text: '处理中', class: 'running' },
    3: { text: '运行成功', class: 'success' },
    4: { text: '错误答案', class: 'error' },
    5: { text: '超时', class: 'error' },
    6: { text: '编译错误', class: 'error' },
    7: { text: '运行时错误', class: 'error' },
    8: { text: '系统错误', class: 'error' },
    9: { text: '已终止', class: 'success' },
    10: { text: '内部错误', class: 'error' },
    11: { text: '无效输入', class: 'error' },
    12: { text: '权限不足', class: 'error' },
    13: { text: '内存不足', class: 'error' },
    14: { text: '输出超限', class: 'error' },
};

function updateStatus(status) {
    statusBadge.classList.remove('hidden', 'success', 'error', 'running');
    const info = STATUS_MAP[status] || { text: '未知', class: 'error' };
    statusBadge.textContent = info.text;
    statusBadge.classList.add(info.class);
}

function hideStatus() {
    statusBadge.classList.add('hidden');
}

function showOutput(text, isError = false) {
    outputEl.textContent = text;
    outputEl.style.color = isError ? 'var(--error-color)' : 'var(--text-primary)';
}

function showLoading() {
    outputEl.textContent = '正在编译运行...';
    outputEl.style.color = 'var(--text-secondary)';
}

function setRunningState(running) {
    runBtn.disabled = running;
    runBtnLabel.textContent = running ? '编译中...' : '编译运行';
}

// ============ 提交代码 ============
async function submitToEdgeApi(sourceCode, stdin) {
    const response = await fetchWithTimeout(
        EDGE_API_URL,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_code: sourceCode, stdin, language_id: C_LANGUAGE_ID }),
        },
        REQUEST_TIMEOUT_MS
    );
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Edge API 错误 (${response.status}): ${errText.substring(0, 200)}`);
    }
    return response.json();
}

async function submitToBackendRun(sourceCode, stdin) {
    const url = `${BACKEND_RUN_URL.replace(/\/$/, '')}/api/run`;
    const response = await fetchWithTimeout(
        url,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_code: sourceCode, stdin, language_id: C_LANGUAGE_ID }),
        },
        REQUEST_TIMEOUT_MS
    );
    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`后端错误 (${response.status}): ${errText.substring(0, 200)}`);
    }
    return response.json();
}

async function submitToJudge0Direct(sourceCode, stdin) {
    const judge0Url = 'https://ce.judge0.com/submissions?base64_encoded=true&wait=true';
    const targetUrl = USE_PROXY ? `${JUDGE0_PROXY_URL}?url=${encodeURIComponent(judge0Url)}` : judge0Url;
    const response = await fetchWithTimeout(
        targetUrl,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                language_id: C_LANGUAGE_ID,
                source_code: toBase64Utf8(sourceCode),
                stdin: stdin ? toBase64Utf8(stdin) : '',
                cpu_time_limit: 5,
                memory_limit: 128000,
            }),
        },
        REQUEST_TIMEOUT_MS
    );
    if (!response.ok) {
        throw new Error(`Judge0 错误 (HTTP ${response.status})`);
    }
    const result = await response.json();
    return {
        ...result,
        stdout: result.stdout ? fromBase64Utf8(result.stdout) : '',
        stderr: result.stderr ? fromBase64Utf8(result.stderr) : '',
        compile_output: result.compile_output ? fromBase64Utf8(result.compile_output) : '',
        message: result.message || '',
    };
}

let lastSubmitTime = 0;
let isRunning = false;

async function runCode() {
    if (isRunning) return;

    const sourceCode = editor.getValue();
    const stdin = stdinInput.value;
    const cleanCode = sanitizeCode(sourceCode);

    if (cleanCode !== sourceCode) {
        console.log('[Sanitize] 检测到中文标点，已自动替换');
    }
    if (cleanCode.length > MAX_CODE_LENGTH) {
        showOutput(`代码过长（超过 ${MAX_CODE_LENGTH / 1024}KB 限制）`, true);
        return;
    }
    if (!cleanCode.trim()) {
        showOutput('请输入代码', true);
        return;
    }

    // 冷却控制
    const now = Date.now();
    const elapsed = now - lastSubmitTime;
    if (elapsed < COOLDOWN_MS && lastSubmitTime > 0) {
        const wait = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        showOutput(`请求太频繁，请等待 ${wait} 秒后重试`, true);
        return;
    }

    setRunningState(true);
    lastSubmitTime = now;
    showLoading();
    hideStatus();

    const startTime = performance.now();
    let backendInfo = '';

    try {
        let result;
        // 优先级：Edge API > 自建后端 > 直接 Judge0
        if (EDGE_API_URL) {
            try {
                result = await submitToEdgeApi(cleanCode, stdin);
                backendInfo = 'EdgeOne /api';
            } catch (e) {
                console.warn('[Submit] Edge API 失败，尝试备用:', e.message);
                backendInfo = `/api 失败: ${e.message}`;
            }
        }
        if (!result && BACKEND_RUN_URL) {
            try {
                result = await submitToBackendRun(cleanCode, stdin);
                backendInfo = '自建后端';
            } catch (e) {
                console.warn('[Submit] 后端失败，尝试直连:', e.message);
                backendInfo += ` | 后端失败: ${e.message}`;
            }
        }
        if (!result) {
            result = await submitToJudge0Direct(cleanCode, stdin);
            backendInfo = backendInfo ? backendInfo + ' | 直连 Judge0' : '直连 Judge0';
        }

        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        const compileOutput = result.compile_output || '';
        const message = result.message || '';
        const statusId = result.status && typeof result.status.id === 'number' ? result.status.id : 10;

        updateStatus(statusId);

        let output = '';
        if (compileOutput) output += `[编译输出]\n${compileOutput}\n\n`;
        if (stdout) output += `[输出]\n${stdout}`;
        if (stderr) output += `[错误]\n${stderr}`;
        if (message) output += `[信息]\n${message}\n`;
        if (!output && statusId === 3) output = '程序运行成功，无输出';

        const elapsedMs = Math.round(performance.now() - startTime);
        output += `\n[耗时] ${elapsedMs}ms | 后端: ${backendInfo}`;

        showOutput(output || '无输出', statusId >= 4);
    } catch (error) {
        updateStatus(10);
        let errorMsg = error.message;
        if (error.name === 'AbortError') {
            errorMsg = '请求超时，请稍后重试';
        } else if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = '网络连接失败，请检查网络';
        } else if (errorMsg.includes('429')) {
            errorMsg = '请求过于频繁，Judge0 已限流';
        }
        showOutput(`错误: ${errorMsg}`, true);
        console.error('编译错误:', error);
    } finally {
        setRunningState(false);
    }
}

// ============ 其他功能 ============
function clearCode() {
    editor.setValue('');
    outputEl.textContent = '点击"编译运行"查看结果...';
    outputEl.style.color = 'var(--text-secondary)';
    hideStatus();
    stdinInput.value = '';
    localStorage.removeItem(STORAGE_KEY);
}

function resetToTemplate() {
    editor.setValue(DEFAULT_CODE);
    outputEl.innerHTML = '<span class="placeholder">点击"编译运行"查看结果...</span>';
    outputEl.style.color = '';
    hideStatus();
    stdinInput.value = '';
}

function downloadCode() {
    const code = sanitizeCode(editor.getValue());
    if (!code.trim()) return;
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'main.c';
    a.click();
    URL.revokeObjectURL(url);
}

// 事件监听
runBtn.addEventListener('click', runCode);
clearBtn.addEventListener('click', clearCode);
downloadBtn?.addEventListener('click', downloadCode);
resetBtn?.addEventListener('click', resetToTemplate);

// 键盘快捷键
editor.setOption('extraKeys', {
    'Ctrl-Enter': runCode,
    'Cmd-Enter': runCode,
    'Ctrl-S': () => downloadCode(),
    'Cmd-S': () => downloadCode(),
});

console.log('番星C语言编辑器已加载');
