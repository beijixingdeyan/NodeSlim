# Quickstart

## One-Click Flow

```bash
git clone <your-fork> && cd nodeslim
npm install
npm link
nodeslim scan                # 1. 诊断
nodeslim optimize --clean --dry-run  # 2. 预览清理
nodeslim dashboard           # 3. 可视化
```

## 在已有项目中使用

```bash
cd /your/project
npx nodeslim scan --output html --save-report
# 打开 .nodeslim/reports/latest.html
```

## 常见问题

- **无 node_modules**: 运行 `npm install` 后再扫描；工具也会基于 package.json 给出建议。
- **Dashboard 空白**: 先运行 `nodeslim scan` 生成 latest.json。
- **清理安全吗**: `--dry-run` 仅预览；执行前建议 git commit。
- **迁移 pnpm**: 默认仅生成计划，需 `--force` 才会实际删除并安装。
