// Judge0 API 配置
const JUDGE0_API_URL = 'https://ce.judge0.com';
const C_LANGUAGE_ID = 100; // C (GCC 9.2.0)

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
    outputEl.innerHTML = '<span class="spinner"></span> 正在编译运行...';
    outputEl.style.color = 'var(--text-secondary)';
}

// 提交代码到 Judge0
async function submitCode(sourceCode, stdin = '') {
    const response = await fetch(`${JUDGE0_API_URL}/submissions?base64_encoded=false&wait=false`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            language_id: C_LANGUAGE_ID,
            source_code: sourceCode,
            stdin: stdin,
            cpu_time_limit: 5,
            memory_limit: 128000
        })
    });

    if (!response.ok) {
        throw new Error(`提交失败: ${response.statusText}`);
    }

    return await response.json();
}

// 获取提交结果
async function getResult(token) {
    const response = await fetch(`${JUDGE0_API_URL}/submissions/${token}?base64_encoded=false`);
    
    if (!response.ok) {
        throw new Error(`获取结果失败: ${response.statusText}`);
    }

    return await response.json();
}

// 轮询结果
async function pollResult(token, maxAttempts = 30, interval = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
        const result = await getResult(token);
        
        // 状态 1 和 2 表示还在处理中
        if (result.status.id !== 1 && result.status.id !== 2) {
            return result;
        }
        
        await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    throw new Error('编译超时，请稍后重试');
}

// 运行代码
async function runCode() {
    const sourceCode = editor.getValue();
    const stdin = stdinInput.value;

    if (!sourceCode.trim()) {
        showOutput('请输入代码', true);
        return;
    }

    // 禁用按钮，显示加载中
    runBtn.disabled = true;
    runBtn.innerHTML = '<span class="spinner"></span> 编译中...';
    showLoading();
    hideStatus();

    try {
        // 提交代码
        const { token } = await submitCode(sourceCode, stdin);
        
        // 轮询获取结果
        const result = await pollResult(token);
        
        // 显示结果
        updateStatus(result.status.id);
        
        let output = '';
        
        // 编译输出（如果有错误）
        if (result.compile_output) {
            output += `=== 编译输出 ===\n${result.compile_output}\n\n`;
        }
        
        // 标准输出
        if (result.stdout) {
            output += `=== 输出 ===\n${result.stdout}`;
        }
        
        // 标准错误
        if (result.stderr) {
            output += `=== 错误 ===\n${result.stderr}`;
        }
        
        // 如果没有任何输出
        if (!output && result.status.id === 3) {
            output = '程序运行成功，无输出';
        }
        
        // 显示时间/内存使用
        if (result.time && result.memory) {
            output += `\n\n=== 资源使用 ===\n时间: ${result.time}s | 内存: ${result.memory} KB`;
        }
        
        const isError = result.status.id >= 4;
        showOutput(output || '无输出', isError);
        
    } catch (error) {
        updateStatus(10);
        showOutput(`错误: ${error.message}`, true);
        console.error('编译错误:', error);
    } finally {
        runBtn.disabled = false;
        runBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
            </svg>
            编译运行
        `;
    }
}

// 清空代码
function clearCode() {
    editor.setValue('');
    showOutput('<span class="placeholder">点击"编译运行"查看结果...</span>');
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
