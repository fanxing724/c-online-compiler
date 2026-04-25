// Judge0 API 配置
const JUDGE0_API_URL = 'https://ce.judge0.com';
const C_LANGUAGE_ID = 50; // C (GCC 12.2.0)
const COOLDOWN_MS = 5000; // 5秒请求冷却
const MAX_CODE_LENGTH = 32768; // 32KB 代码限制

// 使用 codetabs 代理（较稳定）
const CORS_PROXY = 'https://api.codetabs.com/v1/proxy?quest=';

let lastSubmitTime = 0;
let isRunning = false;

// 默认 C 代码模板
const DEFAULT_CODE = `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
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

// 设置默认代码
editor.setValue(DEFAULT_CODE);

// DOM 元素
const runBtn = document.getElementById('runBtn');
const clearBtn = document.getElementById('clearBtn');
const outputEl = document.getElementById('output');
const statusBadge = document.getElementById('statusBadge');
const stdinInput = document.getElementById('stdinInput');

// 状态映射
const STATUS_MAP = {
    1: { text: '等待中', class: 'running' },
    2: { text: '处理中', class: 'running' },
    3: { text: '已接受', class: 'success' },
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

// 提交代码到 Judge0
async function submitCode(sourceCode, stdin = '') {
    const targetUrl = `${JUDGE0_API_URL}/submissions?base64_encoded=false&wait=false`;
    const url = CORS_PROXY + encodeURIComponent(targetUrl);
    
    console.log('目标:', targetUrl);
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            language_id: C_LANGUAGE_ID,
            source_code: sourceCode,
            stdin: stdin,
            cpu_time_limit: 5,
            memory_limit: 128000
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`提交失败 (${response.status})`);
    }

    const data = await response.json();
    console.log('Token:', data.token);
    return data;
}

// 获取提交结果
async function getResult(token) {
    const targetUrl = `${JUDGE0_API_URL}/submissions/${token}?base64_encoded=false`;
    const url = CORS_PROXY + encodeURIComponent(targetUrl);
    
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`获取结果失败`);
    }
    return await response.json();
}

// 轮询结果
async function pollResult(token) {
    let delay = 800;
    const maxAttempts = 50;
    
    for (let i = 0; i < maxAttempts; i++) {
        const result = await getResult(token);
        console.log('轮询结果, 状态:', result.status.id);
        
        if (result.status.id > 2) {
            return result;
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.3, 2000);
    }
    
    throw new Error('编译超时');
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

    isRunning = true;
    lastSubmitTime = now;
    runBtn.disabled = true;
    runBtn.textContent = '编译中...';
    showLoading();
    hideStatus();

    try {
        const { token } = await submitCode(sourceCode, stdin);
        const result = await pollResult(token);
        
        updateStatus(result.status.id);
        
        let output = '';
        
        if (result.compile_output) {
            output += `[编译输出]\n${result.compile_output}\n\n`;
        }
        
        if (result.stdout) {
            output += `[输出]\n${result.stdout}`;
        }
        
        if (result.stderr) {
            output += `[错误]\n${result.stderr}`;
        }
        
        if (result.message) {
            output += `[信息]\n${result.message}\n`;
        }
        
        if (!output && result.status.id === 3) {
            output = '程序运行成功，无输出';
        }
        
        if (result.time !== null && result.memory !== null) {
            output += `\n\n[资源] 时间: ${result.time}s | 内存: ${result.memory} KB`;
        }
        
        const isError = result.status.id >= 4;
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
        isRunning = false;
        runBtn.disabled = false;
        runBtn.textContent = '编译运行';
    }
}

// 清空代码
function clearCode() {
    editor.setValue('');
    outputEl.textContent = '点击"编译运行"查看结果...';
    outputEl.style.color = 'var(--text-secondary)';
    hideStatus();
    stdinInput.value = '';
}

// 事件监听
runBtn.addEventListener('click', runCode);
clearBtn.addEventListener('click', clearCode);

// 键盘快捷键
editor.setOption('extraKeys', {
    'Ctrl-Enter': runCode,
    'Cmd-Enter': runCode
});

// 页面加载完成提示
console.log('C语言在线编译器已加载');
