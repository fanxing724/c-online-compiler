// Judge0 API 配置
const APP_CONFIG = window.__APP_CONFIG__ || {};
const JUDGE0_API_URL = APP_CONFIG.judge0ApiUrl || 'https://ce.judge0.com';
const JUDGE0_PROXY_URL = APP_CONFIG.judge0ProxyUrl || '';
const BACKEND_RUN_URL = APP_CONFIG.backendRunUrl || '';
const USE_PROXY = APP_CONFIG.useProxy !== false && Boolean(JUDGE0_PROXY_URL);
const C_LANGUAGE_ID = 50; // C (GCC 12.2.0)
const COOLDOWN_MS = 5000; // 5秒请求冷却
const MAX_CODE_LENGTH = 32768; // 32KB 代码限制
const STORAGE_KEY = 'fanxing_c_compiler_code';

let lastSubmitTime = 0;
let isRunning = false;

// 默认 C 代码模板
const DEFAULT_CODE = `#include <stdio.h>

int main() {
    printf(“Hello, World!\\n”);
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

// 恢复上次编辑的代码，或加载默认模板
const savedCode = localStorage.getItem(STORAGE_KEY);
editor.setValue(savedCode || DEFAULT_CODE);

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

if (appVersion) {
    appVersion.textContent = APP_CONFIG.version || 'dev';
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

function buildJudge0Url() {
    if (!USE_PROXY) {
        return `${JUDGE0_API_URL}/submissions?base64_encoded=true&wait=true`;
    }

    const target = `${JUDGE0_API_URL}/submissions?base64_encoded=true&wait=true`;
    return `${JUDGE0_PROXY_URL}?url=${encodeURIComponent(target)}`;
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

// 提交代码到 Judge0（同步等待结果，base64编码）
async function submitCode(sourceCode, stdin = '') {
    const backendUrl = buildBackendRunUrl();

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

    const url = buildJudge0Url();
    console.log('提交到:', url);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            language_id: C_LANGUAGE_ID,
            source_code: toBase64Utf8(sourceCode),
            stdin: stdin ? toBase64Utf8(stdin) : '',
            cpu_time_limit: 5,
            memory_limit: 128000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`提交失败 (${response.status}): ${errText.substring(0, 200)}`);
    }

    const result = await response.json();
    console.log('结果:', JSON.stringify(result, null, 2));
    return normalizeJudge0Result(result);
}

// 运行代码
async function runCode() {
    if (isRunning) {
        console.log('正在运行中，忽略请求');
        return;
    }
    
    const sourceCode = editor.getValue();
    const stdin = stdinInput.value;

    // 代码长度检查
    if (sourceCode.length > MAX_CODE_LENGTH) {
        showOutput(`代码过长（超过 ${MAX_CODE_LENGTH/1024}KB 限制）`, true);
        return;
    }

    if (!sourceCode.trim()) {
        showOutput('请输入代码', true);
        return;
    }

    // 冷却时间检查
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

    try {
        const result = await submitCode(sourceCode, stdin);
        
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
        
        if (result.time !== null && result.time !== undefined && 
            result.memory !== null && result.memory !== undefined) {
            output += `\n\n[资源] 时间: ${result.time}s | 内存: ${result.memory} KB`;
        }

        const elapsedMs = Math.round(performance.now() - startTime);
        output += `\n[耗时] ${elapsedMs}ms`;
        
        const isError = statusId >= 4;
        showOutput(output || '无输出', isError);
        
    } catch (error) {
        updateStatus(10);
        
        let errorMsg = error.message;
        if (errorMsg.includes('Failed to fetch') || errorMsg.includes('NetworkError')) {
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

// 清空代码
function clearCode() {
    editor.setValue('');
    outputEl.textContent = '点击”编译运行”查看结果...';
    outputEl.style.color = 'var(--text-secondary)';
    hideStatus();
    stdinInput.value = '';
    localStorage.removeItem(STORAGE_KEY);
}

// 重置为默认模板
function resetToTemplate() {
    editor.setValue(DEFAULT_CODE);
    outputEl.innerHTML = '<span class=”placeholder”>点击”编译运行”查看结果...</span>';
    outputEl.style.color = '';
    hideStatus();
    stdinInput.value = '';
}

// 下载代码为 .c 文件
function downloadCode() {
    const code = editor.getValue();
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

// 页面加载完成提示
console.log('C语言在线编译器已加载');
