# 番星C语言编辑器

浏览器里的 C 在线编译器，提供深色编辑器布局和移动端适配，与 [Java 版本](https://github.com/fanxing724/java-online-compiler) 同步维护。前端使用 CodeMirror，代码交给 Judge0 沙箱编译执行，本机和 EdgeOne 不执行用户提交的 C 程序。

## 功能

- C（GCC 9.2.0，Judge0 ID `50`）。
- C 语法高亮、括号补全、行号；编辑器 CDN 不可用时回退到文本编辑。
- Hello World / 中文输出、标准输入求和、数组排序示例。
- 标准输出、错误输出、编译错误、运行状态、执行时间与内存展示。
- 下载原文 `main.c`，支持 `Ctrl/⌘ + S` 下载、`Ctrl/⌘ + Enter` 运行。
- 当前浏览器自动保存源码、标准输入和编译器版本；独立存储键 `fanxing_c_compiler_v1`，与 Java 项目的存储隔离；兼容读取旧键 `fanxing_c_compiler_code`，不删除旧内容。
- 清空和重置前提示确认，保留中文字符串、注释和标点原文。

使用标准 C 语言与 `main` 函数。仅支持单个源文件及编译环境提供的标准库。

## 本地运行

需要 Node.js 20 或更高版本，无 npm 运行依赖，无需安装 GCC。

```bash
git clone git@github.com:fanxing724/c-online-compiler.git
cd c-online-compiler
npm start
```

访问 `http://127.0.0.1:3000`。可用 `HOST`、`PORT` 环境变量调整监听地址和端口。直接双击 HTML 或仅用静态 HTTP 服务无法提供 `/api` 编译接口。

```bash
npm test       # Node 原生测试，使用模拟上游，不提交到公共服务
npm run build  # 生成 dist/：静态文件、LICENSE、edge-functions/
```

## 绑定 GitHub 部署到 EdgeOne Pages / Makers

1. 在 EdgeOne 创建 Pages / Makers 项目，绑定 **`fanxing724/c-online-compiler`** 的 `main` 分支。
2. 根目录选仓库根目录，框架预设选 **Other / Static**。
3. 构建命令 **`npm run build`**，输出目录 **`dist`**。仓库根的 `edgeone.json` 已声明这两项；控制台若要求手填，使用相同值。
4. 部署完成后访问首页，点击「编译运行」验证中文 Hello World；求和示例应输出 `42`。

保留 `edge-functions/` 目录，路由 `edge-functions/api/index.js` 对应 `/api`，共享模块在 `_lib/` 内。构建结果同时包含函数目录，适用于直接上传：把 `dist/` 的**内容**压缩，使 `index.html` 和 `edge-functions/` 位于 ZIP 首层。不要上传套了一层 `dist/` 目录的包。

`GET /api` 返回 `ok: true` 只说明接口可用，实际编译成功仍需执行示例验证。仓库推送、GitHub Actions 通过和 EdgeOne 线上部署是三个独立状态。

## 可选上游配置

默认使用 `https://ce.judge0.com`。公共服务可能限流、排队或不可用；需要稳定使用时可接入自己的兼容 Judge0 CE 服务。

| 服务端环境变量 | 用途 |
|---|---|
| `JUDGE0_URL` | Judge0 HTTPS 基址，默认 `https://ce.judge0.com` |
| `JUDGE0_AUTH_TOKEN` | 可选的 `X-Auth-Token`，仅在服务端使用 |

EdgeOne 在项目环境变量中配置，修改后重新部署。本地用进程环境变量传入；本项目不会自动读取 `.env`。自建上游需提供 C 语言 ID `50`。

浏览器只调用同源 `/api`；失败会显示错误，不自动绕过本站接口直接请求公共编译服务。运行时源码和标准输入会发往配置的 Judge0 服务，浏览器本地存储也会保留源码与输入，请勿提交敏感信息。

## API

`GET /api` 返回接口版本和支持的 C 编译器。Node 本地服务还提供 `GET /health`、`POST /api/run` 别名；EdgeOne 使用 `/api`。

`POST /api`，`Content-Type: application/json`：

```json
{
  "source_code": "#include <stdio.h>\nint main(void) { puts(\"42\"); return 0; }",
  "stdin": "",
  "language_id": 50
}
```

`language_id` 可省略，默认 `50`。响应示例：

```json
{
  "stdout": "42\n",
  "stderr": "",
  "compile_output": "",
  "message": "",
  "status": { "id": 3, "description": "Accepted" },
  "time": "0.03",
  "memory": 14000
}
```

HTTP 200 表示已拿到编译结果；须通过 `status.id` 判断程序是否成功：`3` 成功、`5` 超时、`6` 编译错误、`7–12` 运行错误、`13` 上游内部错误、`14` 可执行文件格式错误。输出文字按原文显示。

HTTP `400/413/415` 为输入错误，`429` 为限流，`502/504` 为上游失败或超时，`503` 为配置错误或本实例并发已满。

## 限制与验证

- 源码 ≤32KiB、标准输入 ≤16KiB、JSON 请求体 ≤96KiB，均按 UTF-8 字节计。
- Judge0 CPU 限制 5 秒、墙钟限制 10 秒、内存参数 128000KB、文件大小限制 1024KB，禁用程序网络；上游仍按其沙箱及语言规则执行。
- 接口等待上限 25 秒，浏览器等待上限 30 秒。异步轮询支持关闭 `wait=true` 的 Judge0 实例。
- 每个 Node 进程 / Edge isolate 最多 4 个活动编译、每分钟每个识别到的客户端最多 10 次提交；Edge 无可用客户端标识时共用该 isolate 的额度。此内存保护不构成跨节点的全局限流，可在托管平台额外配置规则。
- 背景图随仓库保存在 `assets/background.png`，构建时复制到 `dist/assets/`，页面从本站加载。原始图片地址：[原项目背景图](https://list.yppp.net/d/image/2026-04-03-c1e67c77aec9e74001a5a1ff326ace73.png)。
- CodeMirror 仍从第三方 CDN 加载；加载失败时保留文本编辑。

2026-10-21 本地验证：24 项 Node 自动测试通过，包括 EdgeOne 的 ArrayBuffer、DataView、字符串流、UTF-8 分块和大小限制回归测试；经本地 HTTP 接口调用真实 Judge0，C 中文输出、标准输入求和、数组排序和编译错误由真实 Judge0 验证。Chromium 浏览器验证了桌面运行、main.c 原文下载、刷新恢复、C/Java 存储隔离、320px/390px 手机布局、CDN 和存储不可用时的编辑降级。GitHub Actions 与 EdgeOne 线上状态以各平台实际结果为准。

## 同步更新说明

本次同步 Java 版的请求流兼容、状态映射、UTF-8 大小校验、超时与异步轮询、独立保存、原文下载、仓库内背景图和测试/构建流程。旧 `/proxy` 返回 410，刷新页面后使用 `/api`；`extras/` 保留历史备用文件，不进入构建包。

页面顶部提供“我的 GitHub”（https://github.com/fanxing724）与本项目源码入口。EdgeOne 项目原来若手动填写了输出目录 `/`，请使用当前 `edgeone.json` 的 `npm run build` / `dist` 配置。

## 开源协议

本项目采用 **Academic Free License v3.0（AFL-3.0）**，完整条款见 [LICENSE](LICENSE)。保留原项目协议和来源，第三方资源按各自许可使用。

接口与部署参考：[Judge0 CE API](https://ce.judge0.com/)、[EdgeOne Edge Functions](https://pages.edgeone.ai/document/edge-functions)。
