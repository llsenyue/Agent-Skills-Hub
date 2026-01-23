# Changelog

All notable changes to **Agent Skills Hub** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2026-01-23

### Changed

- ⚡ **Auto-Launch Panel**: 侧边栏改为自动触发模式
  - 点击侧边栏图标将自动打开全屏管理面板
  - 移除了侧边栏中的冗余内容，专注提供快速入口
  - 优化了消息处理逻辑，修复了文件结构问题

## [0.1.5] - 2026-01-23

### Changed

- 🚀 **UI Redesign**: 侧边栏改为 Launcher 模式
  - 简化为"启动器"界面，不再在狭窄的侧边栏挤压内容
  - 提供醒目的 "打开管理面板" 按钮
  - 显示简单的状态统计 (已安装/已激活)
  - 解决窄屏下的显示问题，回归极简主义

## [0.1.4] - 2026-01-23

### Changed

- 💄 **UI Overhaul**: 全新设计的侧边栏 UI
  - 移除了冗余标题，节省空间
  - 更加紧凑的 Skill Card 设计 (padding 优化)
  - 描述文本限制为 2 行，避免挤占空间
  - 使用小圆点替代文字徽章，界面更清爽
  - 自定义滚动条样式

## [0.1.3] - 2026-01-23

### Fixed

- 🐛 彻底修复侧边栏标题和图表缓存问题 (New ID + Icon)
- 💄 优化侧边栏视图 CSS，使其在窄屏下显示更紧凑

## [0.1.1] - [0.1.2] - 2026-01-23

### Changed

- 🔄 内部重构 ViewsContainer ID 以解决冲突
- 🎨 更新应用图标为 S 形科技风格
- 📝 更新产品名称为 "Agent Skills Hub"

## [0.1.0] - 2026-01-23

### Added

- 🎉 **Initial Release**
- 🏠 中央仓库管理 - 统一存储 Skills 到 `~/.agent/skills`
- 🔗 多工具支持 - Claude Code、Gemini CLI、Antigravity、Windsurf、OpenCode、Codex CLI
- 🛒 技能市场 - 浏览和安装 65,000+ 开源 Skills
- 📦 GitHub 导入 - 从 GitHub 仓库导入 Skills
- 🌐 国际化 - 支持中英文界面切换
- ✅ 技能激活/禁用管理
- 🔄 自动更新检测

### Features

- **我的技能**: 查看、搜索、启用/禁用、删除已安装的 Skills
- **技能市场**: 搜索、预览、一键安装来自 Anthropic Skills Registry 的 Skills
- **工具配置**: 管理各 AI 工具的软链接状态和 GitHub 来源
