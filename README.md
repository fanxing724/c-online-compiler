# FanXing Online C

一个静态 C 在线编译器，前端使用 CodeMirror，编译运行由 Judge0 CE 提供。

## 文件说明

- `index.html`：页面结构和运行配置
- `app.js`：编辑器初始化、提交代码、展示运行结果
- `style.css`：桌面端和移动端样式
- `server.js`：Render/Node 后端，负责调用 Judge0
- `package.json`：Render 启动配置
- `proxy/index.js`：EdgeOne Functions 代理
- `worker/index.js`：Cloudflare Worker 代理
- `_routes.json`：EdgeOne Pages 路由配置

## 运行方式

本项目是纯静态页面，可以直接部署到 EdgeOne Pages、Cloudflare Pages 或任意静态托管服务。

本地预览：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

## Judge0 代理

浏览器直接请求 `https://ce.judge0.com` 可能遇到 CORS 或限流问题。推荐使用 Render 后端。整站部署到 Render 时，在 `index.html` 中保持：

```js
window.__APP_CONFIG__ = {
    judge0ApiUrl: 'https://ce.judge0.com',
    judge0ProxyUrl: '',
    useProxy: false,
    backendRunUrl: window.location.origin
};
```

EdgeOne Functions 使用 `proxy/index.js`。

Cloudflare Worker 使用 `worker/index.js`。

## Render 后端部署

Render 更适合做稳定后端。部署方式：

1. 在 Render 新建 `Web Service`
2. 连接本仓库
3. Runtime 选择 `Node`
4. Build Command 留空或填：

```bash
npm install
```

5. Start Command 填：

```bash
npm start
```

6. 部署成功后会得到类似地址：

```text
https://your-app-name.onrender.com
```

如果前端部署在 EdgeOne Pages，后端部署在 Render，把 `index.html` 里的配置改成：

```js
window.__APP_CONFIG__ = {
    judge0ApiUrl: 'https://ce.judge0.com',
    judge0ProxyUrl: '',
    useProxy: false,
    backendRunUrl: 'https://your-app-name.onrender.com'
};
```

前端会请求：

```text
https://your-app-name.onrender.com/api/run
```

本地测试后端：

```bash
npm start
```

健康检查：

```text
http://localhost:3000/health
```

两种代理都使用同一接口：

```text
/proxy?url=https%3A%2F%2Fce.judge0.com%2Fsubmissions%3Fbase64_encoded%3Dtrue%26wait%3Dtrue
```

## 已知限制

- Judge0 CE 公共服务有频率限制，不适合高并发。
- 当前只启用 C 语言，Judge0 language id 为 `50`。
- 代码长度限制为 32KB，CPU 时间限制为 5 秒，内存限制为 128MB。
