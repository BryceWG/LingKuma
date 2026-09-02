# AGENTS.md

LingKuma：开源的 LingQ 替代品 —— 浏览器扩展（Chrome / Edge / Firefox MV3），在网页上高亮、翻译、AI 分析、朗读单词和句子；另附一个可自托管的 Node.js 云同步服务器。提交信息与代码注释大量使用中文。

## 目录结构

- `src/` — 扩展源码
  - `src/service/a*.js` — 内容脚本流水线：`a1_loadKnowWords`（加载生词）→ `a2_hightlight`（高亮）→ `a3_aiFragen`（AI 分析）→ `a4_tooltip_new`（弹窗）→ `a5_a6`（自定义选词/高亮）→ `a7_words_boom`（词爆）→ `a7.1_sentence_navigator`。编号即执行顺序。
  - `src/plugin/` — 功能插件：`tts.js` / `orion_tts.js` / `edge_tts.js`、`bionic.js`、`readingRuler.js`、YouTube 字幕（`youtubeCaption*.js`）、`pos-highlight.js`
  - `src/utils/` — 公共工具：`cloudAPI.js`、`dataAccessLayer.js`、`pdfDetection.js`、`highlight_floating_button.js`、`language-detector/`（预编译 lib）
  - `src/popup/`、`src/options/`、`src/sidebar/`、`src/player/`（offscreen 音频）、`src/Agent/sytle`（注意目录名拼写就是 `sytle`）
  - `src/icons/`、`src/service/image/`（lottie tgs 动图等静态资源）
- `background.js` — MV3 service worker（也走 webpack 打包）
- `content.css` — 内容脚本全局样式
- `manifest.json`（Chrome）/ `manifest-firefox.json`、`manifest-firefox-local.json`（Firefox）
- `server/` — 云同步服务器：Express + Mongoose（MongoDB），路由：`auth` / `words` / `phrases` / `serverSync` / `admin`；JWT + bcrypt 认证
- `docs/` — VitePress 网站/文档源码
- `_locales/` — i18n（manifest 中名称/描述用 `__MSG_*__`）

## 构建

```bash
npm install
npm run build        # webpack 输出到 dist/（已 gitignore），务必记得加新入口/静态资源后重新构建
npm run watch        # 开发时热编译
npm run pack         # 打包 CRX（PowerShell 脚本，仅 Windows）
npm run build:firefox && npm run pack:firefox   # Firefox 版：先切换 manifest
# 服务器（独立 package.json）
cd server && npm install && npm run dev   # nodemon
```

CI：`.github/workflows/docbuild.yml`（构建 docs 站点）。

## 架构约束与坑

- **webpack 每个入口独立产出**，输出路径逐个手写在 `webpack.config.js` 的 `filename` 映射里。新增一个 `src/service/a*.js` 或插件时，必须同时：① 加 entry；② 加输出路径映射；③ 需要时更新 manifest 的 `content_scripts` / `web_accessible_resources`、`CopyPlugin` patterns。
- 打包配置：`iife: false, module: false`（输出是普通脚本而非模块）、`drop_console: true`（**所有 console 语句在构建产物中被删除**，线上调试不能依赖日志）、`ascii_only: true`（中文被转成 \u 转义）。
- 预编译第三方库（`jszip.min.js`、`FileSaver.min.js`、`options/chars/chart.js`、`tgs-player.min.js`、`language-detector/eld.*.js`、`plugin/min/*`）通过 CopyPlugin 的 `{ minimized: true }` 原样复制，**不要**把它们当模块 import。
- 注入到页面里的资源（lottie、视频、offscreen.html、icons 等）必须在 manifest `web_accessible_resources` 白名单里，同时加 CopyPlugin 复制项，否则线上报资源加载失败。
- 内容脚本以 `all_frames: true`、`match_about_blank: true`、`document_idle` 运行，且各脚本是**独立入口**（非模块导入），脚本内要有自带的重复初始化保护（近期修过 popup/options 双加载问题）。
- MV3 service worker 无 DOM；音频播放走 `src/player/offscreen.html`（offscreen document）。
- Firefox 与 Chrome 的 manifest 不兼容（`browser_specific_settings` 只有 Firefox 能认），改动 manifest 时要同步两个版本。
- 服务端配置走环境变量：`MONGODB_URI`、`JWT_SECRET`、`ADMIN_PASSWORD`、`REGISTER_MODE`；生产用 Docker（见 `server/readme.md`）。

## 改动前必读

- `README.md` / `README.zh.md` — 项目能力与定位
- `server/readme.md` — 同步服务器部署与环境变量
- `webpack.config.js` — 改动任何入口/静态资源前先看它