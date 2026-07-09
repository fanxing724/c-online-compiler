// Judge0 API 多后端管理器
// 特性：健康检查、自动选择最快后端、故障切换、熔断保护

const APP_CONFIG = window.__APP_CONFIG__ || {};
const JUDGE0_PROXY_URL = APP_CONFIG.judge0ProxyUrl || '';
const BACKEND_RUN_URL = APP_CONFIG.backendRunUrl || '';
const EDGE_API_URL = APP_CONFIG.edgeApiUrl || '';
const USE_PROXY = APP_CONFIG.useProxy !== false && Boolean(JUDGE0_PROXY_URL);
const C_LANGUAGE_ID = 50; // C (GCC 12.2.0)
const COOLDOWN_MS = 5000; // 5秒请求冷却
const MAX_CODE_LENGTH = 32768; // 32KB 代码限制
const STORAGE_KEY = 'fanxing_c_compiler_code';

// 熔断阈值
const FAIL_THRESHOLD = 3;
const FAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5分钟冷却

let lastSubmitTime = 0;
let isRunning = false;
let activeBackend = null;
let fallbackCount = 0;

// 多后端配置：在此处添加更多 Judge0 实例
// priority 越小越优先，failCount 连续失败次数
const BACKENDS = [
    {
        id: 'ce',
        name: 'Judge0 CE (官方)',
        baseUrl: 'https://ce.judge0.com',
        priority: 1,
        enabled: true,
        failCount: 0,
        lastFail: 0,
        latency: null,
        isHealthy: null
    },
    // 添加更多实例示例：
    // {
    //     id: 'custom1',
    //     name: '自建实例 A',
    //     baseUrl: 'https://your-judge0.example.com',
    //     priority: 2,
    //     enabled: true,
    //     failCount: 0,
    //     lastFail: 0,
    //     latency: null,
    //     isHealthy: null
    // },
];

// 默认 C 代码模板
const DEFAULT_CODE = `#include <stdio.h>

int main() {
    puts("Hello, World!");
    return 0;
}`;

// 初始化 CodeMirror 编辑器
const editor = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
    mode: 'text/x-csrc',
    theme: 'dracula',
    lineNumbers: true,
    autoCloseBrackets: true,
    matchBrackets: true,
    indentUnit: 4,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true
});

// localStorage 版本迁移 + 强制加载默认模板
// 旧缓存里可能有弯引号，直接清掉，用默认模板
const STORAGE_VERSION = 3;
const savedVersion = localStorage.getItem(STORAGE_KEY + '_version');
if (savedVersion !== String(STORAGE_VERSION)) {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.setItem(STORAGE_KEY + '_version', STORAGE_VERSION);
}
const savedCode = localStorage.getItem(STORAGE_KEY);
// 检查旧缓存是否含有非法字符（弯引号等），有则丢弃用默认模板
const hasBadChars = savedCode && /[\u201c\u201d\u2018\u2019]/.test(savedCode);
if (hasBadChars) {
    localStorage.removeItem(STORAGE_KEY);
    console.log('[Storage] 检测到旧缓存含非法字符，已丢弃');
}
// 用默认模板，除非有干净的已保存代码
editor.setValue(savedCode && savedCode.trim() && !hasBadChars ? savedCode : DEFAULT_CODE);
console.log('[Editor] 代码已加载，来源:', savedCode && savedCode.trim() ? 'localStorage' : '默认模板');

// 自动保存（1秒防抖）
let saveTimer = null;
editor.on('change', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, editor.getValue());
    }, 1000);
});

// DOM 元素
const runBtn = document.getElementById('runBtn');
const runBtnLabel = document.getElementById('runBtnLabel');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const outputEl = document.getElementById('output');
const statusBadge = document.getElementById('statusBadge');
const stdinInput = document.getElementById('stdinInput');
const appVersion = document.getElementById('appVersion');
const backendStatusEl = document.getElementById('backendStatus');
const deployStatusEl = document.getElementById('deployStatus');

if (appVersion) {
    appVersion.textContent = APP_CONFIG.version || 'dev';
}

// ============ 部署状态检测 ============

async function checkDeployment() {
    if (!deployStatusEl) return;

    const checks = [];
    checks.push(`JS: ${APP_CONFIG.version || 'dev'}`);
    checks.push(`edgeApiUrl: ${EDGE_API_URL || '未配置'}`);

    if (EDGE_API_URL) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 5000);
            const res = await fetch(EDGE_API_URL, { signal: controller.signal });
            clearTimeout(timer);
            const data = await res.json();
            if (data.ok) {
                checks.push('/api: 正常');
                deployStatusEl.className = 'backend-status healthy';
            } else {
                checks.push(`/api: 异常 (${res.status})`);
                deployStatusEl.className = 'backend-status error';
            }
        } catch (e) {
            checks.push(`/api: 失败 (${e.message})`);
            deployStatusEl.className = 'backend-status error';
        }
    } else {
        checks.push('/api: 旧版JS，需强刷');
        deployStatusEl.className = 'backend-status error';
    }

    deployStatusEl.textContent = checks.join(' | ');
}

checkDeployment();

// ============ 多后端管理器 ============

/**
 * 获取所有可用后端（排除熔断冷却中的）
 */
function getAvailableBackends() {
    const now = Date.now();
    return BACKENDS
        .filter(b => b.enabled && b.isHealthy !== false)
        .filter(b => {
            if (b.failCount >= FAIL_THRESHOLD) {
                return now - b.lastFail > FAIL_COOLDOWN_MS;
            }
            return true;
        })
        .sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.latency !== null && b.latency !== null) return a.latency - b.latency;
            return 0;
        });
}

/**
 * 健康检查：向一个后端发送测试请求，测量延迟
 */
async function healthCheck(backend, timeout = 5000) {
    const testPayload = {
        language_id: C_LANGUAGE_ID,
        source_code: toBase64Utf8('int main(){return 0;}'),
        stdin: '',
        cpu_time_limit: 1,
        memory_limit: 128000
    };

    const url = buildJudge0Url(backend);

    const start = performance.now();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload),
            signal: controller.signal
        });

        clearTimeout(timer);
        const latency = Math.round(performance.now() - start);

        if (response.ok || response.status === 201 || response.status === 200) {
            backend.latency = latency;
            backend.isHealthy = true;
            backend.failCount = 0;
            return { ok: true, latency };
        } else {
            backend.isHealthy = false;
            backend.failCount++;
            backend.lastFail = Date.now();
            return { ok: false, latency };
        }
    } catch (e) {
        backend.isHealthy = false;
        backend.failCount++;
        backend.lastFail = Date.now();
        return { ok: false, latency: null };
    }
}

/**
 * 并行健康检查所有后端，选出最佳后端
 */
async function selectBestBackend() {
    await Promise.allSettled(
        BACKENDS.filter(b => b.enabled).map(async (b) => {
            await healthCheck(b, 5000);
        })
    );

    const available = getAvailableBackends();
    if (available.length === 0) {
        const allSorted = [...BACKENDS].filter(b => b.enabled)
            .sort((a, b) => a.lastFail - b.lastFail);
        if (allSorted.length > 0) {
            allSorted[0].failCount = 0;
            activeBackend = allSorted[0];
        }
    } else {
        activeBackend = available[0];
    }

    updateBackendUI();
    return activeBackend;
}

/**
 * 标记后端失败，切换到下一个
 */
function markBackendFailed(backend) {
    if (!backend) return;
    backend.failCount++;
    backend.lastFail = Date.now();

    const available = getAvailableBackends();
    const next = available.find(b => b.id !== backend.id);

    if (next) {
        fallbackCount++;
        activeBackend = next;
        console.log(`[Backend] ${backend.name} 故障，切换到 ${next.name}`);
    } else {
        activeBackend = null;
        console.log(`[Backend] 所有后端均不可用`);
    }

    updateBackendUI();
}

/**
 * 更新后端状态 UI
 */
function updateBackendUI() {
    if (backendStatusEl) {
        if (activeBackend) {
            const latencyStr = activeBackend.latency !== null
                ? ` (${activeBackend.latency}ms)`
                : '';
            backendStatusEl.textContent = activeBackend.name + latencyStr;
            backendStatusEl.className = 'backend-status healthy';
        } else {
            backendStatusEl.textContent = '无可用后端';
            backendStatusEl.className = 'backend-status error';
        }
    }
}

// ============ 工具函数 ============

/**
 * 提交前清理代码：移除中文弯引号、全角标点等非法字符
 * 用空字符串移除而非替换，避免在字符串内部产生多余的引号导致 C 语法错误
 */
function sanitizeCode(code) {
    return code
        .replace(/\u201c/g, '')   // 左双弯引号 " → 移除
        .replace(/\u201d/g, '')   // 右双弯引号 " → 移除
        .replace(/\u2018/g, '')  // 左单弯引号 ' → 移除
        .replace(/\u2019/g, '')  // 右单弯引号 ' → 移除
        .replace(/\uff02/g, '"')   // 全角双引号 " → 英文引号
        .replace(/\u300c/g, '"')   // 左书名号「 → 英文引号
        .replace(/\u300d/g, '"')   // 右书名号」 → 英文引号
        .replace(/\u300e/g, "'")   // 左书名号『 → 英文单引号
        .replace(/\u300f/g, "'")   // 右书名号』 → 英文单引号
        .replace(/\u300a/g, '[')   // 左书名号《 → 方括号
        .replace(/\u300b/g, ']')   // 右书名号》 → 方括号
        .replace(/\u2014/g, '--')  // em dash — → 双连字符
        .replace(/\u2013/g, '-')   // en dash – → 连字符
        .replace(/\uff01/g, '!')   // 全角感叹号！ → !
        .replace(/\uff08/g, '(')   // 全角左括号（ → (
        .replace(/\uff09/g, ')')   // 全角右括号） → )
        .replace(/\uff0c/g, ',')   // 全角逗号， → ,
        .replace(/\u3002/g, '.')   // 句号。 → .
        .replace(/\uff1a/g, ':')   // 全角冒号： → :
        .replace(/\uff1b/g, ';')   // 全角分号； → ;
        .replace(/\uff1f/g, '?')   // 全角问号？ → ?
        .replace(/\uff5e/g, '~')   // 全角波浪号～ → ~
        .replace(/\uffe5/g, '$');  // 全角人民币￥ → $
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
    return new TextDecoder().decode(Uint8Array.from(atob(text), c => c.charCodeAt(0)));
}

function buildJudge0Url(backend) {
    const base = backend.baseUrl + '/submissions?base64_encoded=true&wait=true';
    if (!USE_PROXY) return base;
    return `${JUDGE0_PROXY_URL}?url=${encodeURIComponent(base)}`;
}

function buildBackendRunUrl() {
    return BACKEND_RUN_URL ? `${BACKEND_RUN_URL.replace(/\/$/, '')}/api/run` : '';
}

function normalizeJudge0Result(result) {
    return {
        ...result,
        stdout: result.stdout ? fromBase64Utf8(result.stdout) : '',
        stderr: result.stderr ? fromBase64Utf8(result.stderr) : '',
        compile_output: result.compile_output ? fromBase64Utf8(result.compile_output) : '',
        message: result.message || ''
    };
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

// 更新状态徽章
function updateStatus(status) {
    statusBadge.classList.remove('hidden', 'success', 'error', 'running');
    const statusInfo = STATUS_MAP[status] || { text: '未知', class: 'error' };
    statusBadge.textContent = statusInfo.text;
    statusBadge.classList.add(statusInfo.class);
}

function hideStatus() {
    statusBadge.classList.add('hidden');
}

// 显示输出
function showOutput(text, isError = false) {
    outputEl.textContent = text;
    outputEl.style.color = isError ? 'var(--error-color)' : 'var(--text-primary)';
}

function showLoading() {
    outputEl.textContent = '正在编译运行...';
    outputEl.style.color = 'var(--text-secondary)';
}

function setRunningState(running) {
    isRunning = running;
    runBtn.disabled = running;
    runBtnLabel.textContent = running ? '编译中...' : '编译运行';
}

// ============ 提交代码（多后端自动切换）============

async function submitToEdgeApi(sourceCode, stdin = '') {
    const response = await fetch(EDGE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source_code: sourceCode,
            stdin,
            language_id: C_LANGUAGE_ID
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Edge API 错误 (${response.status}): ${errText.substring(0, 200)}`);
    }

    return await response.json();
}

async function submitToBackend(backend, sourceCode, stdin = '') {
    const url = buildJudge0Url(backend);
    const payload = {
        language_id: C_LANGUAGE_ID,
        source_code: toBase64Utf8(sourceCode),
        stdin: stdin ? toBase64Utf8(stdin) : '',
        cpu_time_limit: 5,
        memory_limit: 128000
    };

    const start = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
    });
    clearTimeout(timer);
    const latency = Math.round(performance.now() - start);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    backend.latency = latency;
    const result = await response.json();
    return normalizeJudge0Result(result);
}

let edgeApiError = '';
let edgeApiUsed = false;

async function submitCode(sourceCode, stdin = '') {
    edgeApiError = '';
    edgeApiUsed = false;
    // 优先使用 EdgeOne Makers Edge Function API
    if (EDGE_API_URL) {
        try {
            console.log('[Submit] 使用 EdgeOne API:', EDGE_API_URL);
            const result = await submitToEdgeApi(sourceCode, stdin);
            edgeApiUsed = true;
            return result;
        } catch (e) {
            edgeApiError = e.message;
            console.warn('[Submit] EdgeOne API 失败，尝试备用:', e.message);
        }
    }

    const backendUrl = buildBackendRunUrl();

    // 有后端服务时直接使用
    if (backendUrl) {
        console.log('提交到后端:', backendUrl);
        const response = await fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_code: sourceCode,
                stdin,
                language_id: C_LANGUAGE_ID
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`提交失败 (${response.status}): ${errText.substring(0, 200)}`);
        }

        return await response.json();
    }

    // 直接提交到 Judge0：多后端自动切换
    if (!activeBackend) {
        throw new Error('无可用 Judge0 后端，请检查网络');
    }

    const candidates = getAvailableBackends();
    if (candidates.length === 0) {
        throw new Error('所有 Judge0 后端均不可用（可能暂时熔断），请稍后重试');
    }

    const tried = [];
    let lastError = null;

    for (const backend of candidates) {
        tried.push(backend.name);
        try {
            console.log(`[Backend] 尝试 ${backend.name}`);
            const result = await submitToBackend(backend, sourceCode, stdin);

            activeBackend = backend;

            if (backend.id !== candidates[0].id) {
                fallbackCount++;
                updateBackendUI();
            }

            return result;
        } catch (e) {
            console.warn(`[Backend] ${backend.name} 失败:`, e.message);
            markBackendFailed(backend);
            lastError = e;
        }
    }

    throw new Error(`所有后端均失败：${lastError?.message || '未知错误'}。已尝试：${tried.join(' → ')}`);
}

// ============ 运行代码 ============

async function runCode() {
    if (isRunning) {
        console.log('正在运行中，忽略请求');
        return;
    }

    const sourceCode = editor.getValue();
    const stdin = stdinInput.value;

    // 提交前自动清理中文标点（弯引号、全角等）
    const cleanCode = sanitizeCode(sourceCode);
    if (cleanCode !== sourceCode) {
        console.log('[Sanitize] 检测到中文标点，已自动替换');
    }

    if (cleanCode.length > MAX_CODE_LENGTH) {
        showOutput(`代码过长（超过 ${MAX_CODE_LENGTH/1024}KB 限制）`, true);
        return;
    }

    if (!cleanCode.trim()) {
        showOutput('请输入代码', true);
        return;
    }

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
    fallbackCount = 0;

    try {
        const result = await submitCode(cleanCode, stdin);

        const stdout = result.stdout || '';
        const stderr = result.stderr || '';
        const compileOutput = result.compile_output || '';
        const message = result.message || '';

        const statusId = result.status && typeof result.status.id === 'number'
            ? result.status.id
            : 10;

        updateStatus(statusId);

        let output = '';

        if (compileOutput) {
            output += `[编译输出]\n${compileOutput}\n\n`;
        }

        if (stdout) {
            output += `[输出]\n${stdout}`;
        }

        if (stderr) {
            output += `[错误]\n${stderr}`;
        }

        if (message) {
            output += `[信息]\n${message}\n`;
        }

        if (!output && statusId === 3) {
            output = '程序运行成功，无输出';
        }

        const elapsedMs = Math.round(performance.now() - startTime);
        let meta = `\n[耗时] ${elapsedMs}ms`;
        if (edgeApiUsed) {
            meta += ' | 后端: EdgeOne /api';
        } else if (activeBackend) {
            meta += ` | 后端: ${activeBackend.name}`;
        }
        if (edgeApiError) {
            meta += ` | /api 失败: ${edgeApiError}`;
        }
        if (fallbackCount > 0) {
            meta += ` | 切换: ${fallbackCount}次`;
        }
        output += meta;

        const isError = statusId >= 4;
        showOutput(output || '无输出', isError);

    } catch (error) {
        updateStatus(10);

        let errorMsg = error.message;
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
            errorMsg = '网络连接失败，请检查网络';
        } else if (errorMsg.includes('429')) {
            errorMsg = '请求过于频繁，Judge0 已限流';
        } else if (errorMsg.includes('无可用') || errorMsg.includes('均不可用')) {
            errorMsg = errorMsg + '（所有后端可能都在冷却中，请稍后重试）';
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
    'Ctrl-S': function() { downloadCode(); },
    'Cmd-S': function() { downloadCode(); }
});

// ============ 启动：健康检查选择最优后端 ============
selectBestBackend();

console.log('番星C语言编译器已加载（EdgeOne Makers 版 v3.0）');
