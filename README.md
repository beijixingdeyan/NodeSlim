# NodeSlim — Node Modules 智能优化平台

> **从 850MB 到 50MB，一键诊断，智能优化**

[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](#)
[![License](https://img.shields.io/badge/license-MIT-blue)](#)
[![Version](https://img.shields.io/badge/version-1.2.0-667eea)](#)

NodeSlim 是一个**一站式 `node_modules` 诊断与优化工具**：一个命令即可扫描体积、检测重复/膨胀/安全问题、给出替换与清理建议，并一键清理或迁移包管理器。提供 **CLI**、**Web 可视化面板** 与 **CI 集成**，操作极简，适合个人项目到企业级治理。

---

## ✨ 特性

| 功能 | 说明 |
|------|------|
| **体积扫描** | 递归遍历 `node_modules`，按包聚合体积与文件数，支持 `npm/pnpm/yarn/bun` |
| **少扫描** | `nodeslim scan --shallow` 仅解析 `package.json/lockfile`，秒级估算，无需 `node_modules`，前端可直接拖拽文件夹/JSON 进行本地少扫描 |
| **依赖树分析** | 解析 `package.json` + lockfile，识别直接/间接/dev 依赖，标记重复与深度 |
| **重复检测** | 找出多版本/多路径安装，计算“浪费体积”，一键生成 `overrides/resolutions` 去重方案 |
| **膨胀检测** | 超阈值大包 + 文件数过多包，定位 `test/docs/.github` 等冗余 |
| **冗余清理** | 安全规则一键清理 `test, docs, *.md, *.map, .github` 等，支持 `--dry-run` 预览 |
| **Prod/Dev 分离** | `nodeslim analyze --prod` / `optimize --prune-dev` 量化生产与开发体积，Docker 多阶段构建建议 |
| **按需/ESM/平台** | `analyze --unused --on-demand --esm --platform` 检测未使用/幽灵依赖、全量 lodash、CommonJS 与平台二进制冗余 |
| **优化建议** | 内置替换规则库：`moment→dayjs、lodash→es-toolkit、axios→fetch` 等 |
| **包管理器迁移** | `npm ↔ pnpm ↔ yarn ↔ bun` 一键计划与备份，支持 `--force` 自动执行 |
| **Bundle 分析** | 检测 `dist/build/.next` 产物，提示拆包与压缩建议 |
| **Import Maps** | `optimize --import-maps` 生成 `esm.sh` CDN 的零安装 Import Maps，支持 Deno/浏览器 |
| **安全扫描** | 检测已知漏洞版本 (`lodash`, `minimist` 等) 与可疑安装脚本 |
| **全量审计** | `nodeslim audit` 一站式审计（安全+未使用+按需+ESM+平台+治理） |
| **报告导出** | `JSON / HTML (可视化) / Markdown` 三格式，历史对比 |
| **Web 面板** | 本地 `nodeslim dashboard` 启动可视化，支持拖拽导入文件夹/JSON 进行少扫描、`?target=` 切换项目、Chart.js 饼图与去重/Import Maps 可视化 |
| **CI 集成** | 开箱即用 GitHub Actions，阈值告警与 PR 评论，`scripts/check-size.js` 自助阈值检查 |

---

## 🚀 快速开始（1 分钟）

```bash
# 1. 克隆
git clone https://github.com/beijixingdeyan/NodeSlim.git
cd NodeSlim

# 2. 安装
npm install
npm link          # 让 nodeslim 命令全局可用（或用 npx）

# 3. 一键扫描当前项目
nodeslim scan

# 4. 启动可视化面板（浏览器自动打开）
nodeslim dashboard
# 然后访问 http://localhost:3000
```

> 无需 Rust / 数据库 / Redis，**纯 Node.js**，Node 18+ 即开即用。Rust 核心为可选加速，不影响功能。

### 在任意项目中使用（不克隆本仓库）

```bash
# 直接用 npx（发布到 npm 后）
npx nodeslim scan --target /path/to/your-project

# 或全局安装
npm install -g nodeslim
nodeslim scan --target ./my-app
```

---

## 📖 CLI 完整用法

```bash
nodeslim --help
nodeslim --version

# 扫描
nodeslim scan                           # 扫描当前目录
nodeslim scan --target ./my-app         # 指定目录
nodeslim scan --depth 5                 # 限制层级
nodeslim scan --output json             # 终端输出 json
nodeslim scan --output html             # 生成 html 报告
nodeslim scan --save-report             # 保存到 .nodeslim/reports/

# 分析
nodeslim analyze                        # 深度分析
nodeslim analyze --duplicates           # 仅重复
nodeslim analyze --bloat                # 仅膨胀
nodeslim analyze --security             # 仅安全

# 优化
nodeslim optimize --dry-run             # 预览所有可优化
nodeslim optimize --clean --dry-run     # 预览清理（推荐先预览）
nodeslim optimize --clean               # 执行清理（删除冗余文件）
nodeslim optimize --migrate pnpm        # 迁移到 pnpm（生成计划+备份）
nodeslim optimize --migrate pnpm --force # 自动执行迁移（删除 node_modules）
nodeslim optimize --bundle              # Bundle 部署建议

# 报告
nodeslim report                         # 生成最新报告（json+html+md）
nodeslim report --history               # 查看历史对比
nodeslim report --export html           # 导出指定格式
nodeslim report --export pdf            # 通过 HTML 打印为 PDF

# 配置
nodeslim config init                    # 创建 .nodeslimrc.json
nodeslim config get                     # 查看配置
nodeslim config get thresholds.totalSizeMB
nodeslim config set thresholds.totalSizeMB 200

# 面板 & 监控
nodeslim dashboard --port 3000          # 启动面板
nodeslim serve --port 3000              # 同上（别名）
nodeslim watch --threshold 100MB        # 监控变化（实验性）
```

一键技术转换示例（日常最常用）：

```bash
# 一键体积诊断 + 清理预览 + 迁移 pnpm + 打开面板
nodeslim scan && nodeslim optimize --clean --dry-run && nodeslim dashboard
```

---

## 🖥️ Web 面板

```bash
nodeslim dashboard
# Local:   http://localhost:3000
# 自动打开浏览器，支持：
# - 概览：总包数/体积/重复/可优化
# - 体积分布柱 + 饼图（按类别）
# - 包列表（搜索/排序）、重复/膨胀详情
# - 优化建议与安全扫描
# - 一键扫描按钮（调用 /api/scan）
```

面板为静态资源（`web/dist/index.html`），**无需构建**即可运行；`web/` 下另提供 Vite + React 源码，执行 `npm --prefix web run build` 可重新打包。

---

## ⚙️ 配置 (.nodeslimrc.json)

```json
{
  "scan": { "maxDepth": 10, "exclude": ["node_modules/.cache"] },
  "thresholds": { "totalSizeMB": 100, "maxPackageSizeMB": 10 },
  "clean": { "patterns": ["test","docs","*.md","*.map"], "excludePackages": ["@types/*"] },
  "report": { "outputDir": ".nodeslim/reports", "keepHistory": 10 }
}
```

运行 `nodeslim config init` 生成模板，按需调整阈值与清理规则。规则库位于 `rules/clean-rules.json` 与 `rules/replace-rules.json`，可自行扩展。

---

## 🧹 清理规则

默认清理（安全级别）：`test, tests, __tests__, docs, *.md, *.map, .github, .travis.yml, example` 等，通常可节省 **20-30%** 体积，生产环境更可删除 `*.d.ts` 与平台二进制（需确认）。

```bash
nodeslim optimize --clean --dry-run   # 先预览
nodeslim optimize --clean             # 确认后执行
```

---

## 🔄 包管理器迁移

| 场景 | 命令 | 效果 |
|------|------|------|
| npm → pnpm | `nodeslim optimize --migrate pnpm` | 去重 + 节省 70% 磁盘，安装快 2-3 倍 |
| npm → yarn | `nodeslim optimize --migrate yarn` | 扁平化去重 |
| 任意 → bun | `nodeslim optimize --migrate bun` | 极速安装，兼容 npm 生态 |

迁移流程：**备份 lockfile → 更新 packageManager 字段 → 提示手动执行安装**（`--force` 则自动删除并安装），安全可回滚。

---

## 📦 Bundle 部署

检测 `dist/build/.next/out`，若未构建会提示：

```
npx esbuild src/index.js --bundle --platform=node --outfile=dist/bundle.js
npx tsup src/index.ts --format cjs,esm --minify
npx @vercel/ncc build src/index.js -o dist/
```

效果：部署包 500MB → <10MB，冷启动与安全显著优化。

---

## 🔒 CI / GitHub Actions

已内置 `.github/workflows/nodeslim.yml`：

- 监听 `package.json` / lockfile 变更
- 自动 `nodeslim scan` 并上传报告为 Artifact
- 按阈值告警，可在 PR 中自动评论体积对比

启用：推送到 GitHub 即生效，无需额外配置。阈值在 `.nodeslimrc.json` 中调整。

---

## 🐳 Docker

```bash
docker build -t nodeslim .
docker run -p 3000:3000 -v "$PWD":/app/target:ro nodeslim

# 或
docker-compose up --build
# 访问 http://localhost:3000
```

---

## 📂 目录结构

```
nodeslim/
├── bin/nodeslim.js         # CLI 入口
├── src/
│   ├── scanner/            # 扫描引擎（fs 遍历、体积、依赖解析）
│   ├── analyzer/           # 分析引擎（重复/膨胀/安全/Bundle/建议）
│   ├── optimizer/          # 优化引擎（清理/迁移）
│   ├── reporter/           # 报告（terminal/json/html/markdown）
│   ├── commands/           # 命令行实现
│   ├── server/             # 本地 API + 静态服务
│   └── index.js            # commander 注册
├── rules/                  # 清理/替换/安全规则库
├── web/                    # Web 面板（Vite+React 源码 + 预构建 dist）
├── .github/workflows/      # CI
├── Dockerfile / docker-compose.yml
└── .nodeslimrc.json
```

---

## 🧪 测试

```bash
npm test
node --test test/*.test.js
```

---

## 🤝 贡献 & Roadmap

- [x] CLI 扫描/分析/清理/迁移/Bundle/报告
- [x] Web 可视化 + API
- [x] 规则库与安全扫描
- [ ] 增量扫描缓存与历史趋势图
- [ ] VS Code 插件
- [ ] 私有规则市场 / AI 建议

欢迎 PR / Issue！请遵循 MIT 协议，保持无隐私信息提交。

---

## 📄 License

MIT © NodeSlim Contributors
