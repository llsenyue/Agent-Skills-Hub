# 🎯 Agent Skills Hub

<p align="center">
  <img src="docs/images/my-skills-enabled.png" alt="Agent Skills Hub - 我的技能" width="800">
</p>

**Agent Skills Hub** 是一个 VS Code 扩展，用于集中管理多个 AI Agent 工具的 Skills。通过统一的中央仓库，轻松实现 Skills 的跨工具共享、版本同步和一键激活。

## ✨ 核心特性

- 🏠 **中央仓库** - 所有 Skills 统一存储在 `~/.agent/skills`
- 🔗 **多工具支持** - 支持 Claude Code、Gemini CLI、Antigravity、Windsurf、OpenCode、Codex CLI
- 🛒 **技能市场** - 浏览 65,000+ 开源 Skills，一键安装
- � **国际化** - 支持中英文界面切换
- 📦 **GitHub 导入** - 直接从 GitHub 仓库导入 Skills

## 📸 界面预览

### 我的技能 - 已激活

管理所有已安装的 Skills，支持启用/禁用、删除等操作。

<p align="center">
  <img src="docs/images/my-skills-enabled.png" alt="已激活技能" width="800">
</p>

### 我的技能 - 待激活

查看等待激活的 Skills，一键激活后即可使用。

<p align="center">
  <img src="docs/images/my-skills-pending.png" alt="待激活技能" width="800">
</p>

### 技能市场

浏览来自 [Anthropic Skills Registry](https://github.com/anthropics/anthropic-cookbook) 的海量 Skills。

<p align="center">
  <img src="docs/images/marketplace.png" alt="技能市场" width="800">
</p>

### 工具配置

管理各 AI 工具的链接状态和 GitHub 来源。

<p align="center">
  <img src="docs/images/tool-config.png" alt="工具配置" width="800">
</p>

## 🔧 支持的工具

| 工具 | Skills 路径 | 状态 |
|------|-------------|------|
| Claude Code | `~/.claude/skills` | ✅ 支持 |
| Gemini CLI | `~/.gemini/skills` | ✅ 支持 |
| Antigravity | `~/.gemini/antigravity/global_skills` | ✅ 支持 |
| Windsurf | `~/.codeium/windsurf/skills` | ✅ 支持 |
| OpenCode | `~/.config/opencode/skill` | ✅ 支持 |
| Codex CLI | `~/.codex/skills` | ✅ 支持 |

## 🚀 快速开始

### 安装

1. 克隆此仓库：

   ```bash
   git clone https://github.com/llsenyue/agent-skills-hub.git
   cd agent-skills-hub
   ```

2. 安装依赖：

   ```bash
   npm install
   ```

3. 编译：

   ```bash
   npm run compile
   ```

4. 在 VS Code 中按 `F5` 启动调试

### 使用

1. 打开命令面板 (`Ctrl+Shift+P`)
2. 搜索 "Skill Manager: 打开管理面板"
3. 开始管理你的 Skills！

## 📋 命令列表

| 命令 | 说明 |
|------|------|
| `Skill Manager: 打开管理面板` | 打开主界面 |
| `Skill Manager: 初始化中央仓库` | 创建 `~/.agent/skills` 目录 |
| `Skill Manager: 链接所有工具` | 一键链接所有支持的工具 |
| `Skill Manager: 链接指定工具` | 选择单个工具进行链接 |
| `Skill Manager: 查看链接状态` | 显示各工具的链接状态 |
| `Skill Manager: 创建新 Skill` | 从模板创建 Skill 文件 |

## 🏗️ 项目结构

```
agent-skills-hub/
├── src/
│   ├── extension.ts          # 主入口
│   ├── config/
│   │   └── paths.ts          # 路径配置
│   ├── utils/
│   │   ├── skillSources.ts   # Skills 来源管理
│   │   ├── skillMarketplace.ts # 市场功能
│   │   └── toolPaths.ts      # 工具路径
│   ├── views/
│   │   └── skillsPanel.ts    # 主界面 Webview
│   └── templates/            # Skill 模板
├── docs/
│   └── images/               # 文档图片
├── package.json
└── README.md
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT License](LICENSE)

---

<p align="center">
  Made with ❤️ for AI Developers
</p>
