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

## 推荐部署：EdgeOne Pages + EdgeOne Functions

这个项目推荐直接部署到 EdgeOne。前端放在 Pages，Judge0 请求通过 EdgeOne Functions 的 `/proxy` 转发。

### 1. 创建 Pages 项目

1. 打开 EdgeOne 控制台
2. 进入 `Pages`
3. 新建项目
4. 选择 `Git 仓库`
5. 选择 Gitee 仓库：

```text
knight3fax/c-online-compiler
```

如果 EdgeOne 没有自动识别 Gitee，可以选择从 Git URL 导入：

```text
https://gitee.com/knight3fax/c-online-compiler.git
```

### 2. 构建配置

这是纯静态项目，不需要构建。

```text
框架预设：Other / Static
构建命令：留空
输出目录：/
Node 版本：不用设置
```

### 3. 配置函数

仓库里已经有 EdgeOne 函数文件：

```text
proxy/index.js
```

部署后需要让 `/proxy` 路径走这个函数。不同控制台版本入口名字可能略有不同，通常在：

```text
Pages 项目 → Functions / 函数 → 新建函数
```

函数名建议填：

```text
proxy
```

代码内容使用仓库里的：

```text
proxy/index.js
```

### 4. 前端配置

`index.html` 已经默认配置为 EdgeOne 代理模式：

```js
window.__APP_CONFIG__ = {
    judge0ApiUrl: 'https://ce.judge0.com',
    judge0ProxyUrl: '/proxy',
    useProxy: true,
    backendRunUrl: ''
};
```

### 5. 验证

部署完成后打开 Pages 分配的域名，点击 `编译运行`。成功时输出应包含：

```text
Hello, World!
```

如果页面能打开但运行失败，重点检查：

- `/proxy` 函数是否存在
- 函数是否使用了 `proxy/index.js`
- Pages 项目是否重新部署了最新提交

## 其他代理方式

EdgeOne Functions 使用 `proxy/index.js`。

Cloudflare Worker 使用 `worker/index.js`。

## 可选：Render 后端部署

如果以后改用 GitHub，也可以用 Render。部署方式：

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
