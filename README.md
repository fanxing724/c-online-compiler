# 番星C语言编辑器

一个静态 C 在线编译器，前端使用 CodeMirror，编译运行由 Judge0 CE 提供。

## 文件说明

| 文件 | 说明 |
|---|---|
| `index.html` | 页面结构和运行配置 |
| `app.js` | 编辑器初始化、提交代码、展示运行结果 |
| `style.css` | 桌面端和移动端样式 |
| `server.js` | 本地 Node 后端，负责调用 Judge0（可选） |
| `package.json` | 本地启动配置 |
| `edge-functions/api/index.js` | EdgeOne 边缘函数，路由 `/api`，主编译接口 |
| `edge-functions/proxy.js` | EdgeOne 边缘函数，路由 `/proxy`，备用 CORS 代理 |
| `extras/` | 其他平台备用文件（Cloudflare Worker、旧代理等），非 EdgeOne 部署所需 |

## 运行方式

本项目是纯静态页面，可以直接部署到 EdgeOne Pages。

本地预览：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 推荐部署：EdgeOne Pages + Edge Functions

### 1. 创建 Pages 项目

1. 打开 EdgeOne 控制台 → Pages → 新建项目
2. 选择 Git 仓库，导入：`https://gitee.com/knight3fax/c-online-compiler.git`

### 2. 构建配置

纯静态项目，不需要构建：

```
框架预设：Other / Static
构建命令：留空
输出目录：/
```

### 3. 函数自动部署

仓库中的 `edge-functions/` 目录会被 EdgeOne 自动识别：

- `edge-functions/api/index.js` → 路由 `/api`（主编译接口）
- `edge-functions/proxy.js` → 路由 `/proxy`（备用代理）

部署后访问 `https://你的域名/api`，返回 `{"ok":true,...}` 即表示函数生效。

### 4. 前端配置

`index.html` 中已默认配置：

```js
window.__APP_CONFIG__ = {
    version: 'v2026.09.04-edgeone',
    edgeApiUrl: '/api',        // 主接口
    judge0ProxyUrl: '/proxy',  // 备用代理
    useProxy: true,
    backendRunUrl: ''           // 自建后端（可选）
};
```

### 5. 验证

部署完成后打开 Pages 域名，点击「编译运行」。成功时输出应包含：

```
[输出]
Hello, World!
[耗时] xxxms | 后端: EdgeOne /api
```

## 接口说明

### POST /api

主编译接口，接收明文代码，内部调用 Judge0。

请求体：

```json
{
    "source_code": "#include <stdio.h>...",
    "stdin": "",
    "language_id": 50
}
```

响应：

```json
{
    "stdout": "Hello, World!\n",
    "stderr": "",
    "compile_output": "",
    "message": "",
    "status": { "id": 3, "description": "Accepted" },
    "time": "0.001",
    "memory": 1234
}
```

### GET /api

健康检查，返回 `{"ok":true,"service":"c-compiler-api"}`。

### /proxy?url=...

备用 CORS 代理，仅允许转发到 `*.judge0.com` 的 HTTPS 请求。

## 可选：本地后端部署

如果需要自建后端（不依赖 Edge Functions）：

```bash
npm start
```

健康检查：`http://localhost:3000/health`

前端配置 `backendRunUrl` 指向后端地址即可。

## 已知限制

- Judge0 CE 公共服务有频率限制，不适合高并发。
- 当前仅支持 C 语言（language_id = 50）。
- 代码长度限制 32KB，CPU 时间限制 5 秒，内存限制 128MB。
- 背景图片托管于第三方域名，如失效会自动回退为深色背景色。
