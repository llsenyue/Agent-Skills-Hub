/**
 * Skill 模板 - 提供常用 Skill 文件模板
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCentralWarehousePath } from '../config/paths';
import { ensureDirectoryExists } from '../utils/filesystem';

export interface SkillTemplate {
    id: string;
    name: string;
    description: string;
    filename: string;
    content: string;
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
    {
        id: 'code-review',
        name: '代码审查',
        description: '用于代码审查的 Skill 模板',
        filename: 'code-review.md',
        content: `---
description: 代码审查 Skill
---

# 代码审查 Skill

当用户请求代码审查时，请按照以下步骤进行：

## 审查清单

1. **代码风格**
   - 检查命名规范
   - 检查代码格式化
   - 检查注释完整性

2. **逻辑正确性**
   - 验证业务逻辑
   - 检查边界条件
   - 确认错误处理

3. **性能考虑**
   - 识别潜在性能问题
   - 建议优化方案

4. **安全性**
   - 检查输入验证
   - 识别安全漏洞

## 输出格式

请以结构化的方式输出审查结果，包括：
- 问题严重程度（高/中/低）
- 问题描述
- 修改建议
`
    },
    {
        id: 'git-commit',
        name: 'Git 提交',
        description: '生成规范的 Git 提交信息',
        filename: 'git-commit.md',
        content: `---
description: 生成规范的 Git 提交信息
---

# Git 提交信息生成 Skill

根据代码变更生成符合 Conventional Commits 规范的提交信息。

## 提交类型

- \`feat\`: 新功能
- \`fix\`: Bug 修复
- \`docs\`: 文档更新
- \`style\`: 代码格式调整
- \`refactor\`: 代码重构
- \`perf\`: 性能优化
- \`test\`: 测试相关
- \`chore\`: 构建/工具变更

## 格式

\`\`\`
<type>(<scope>): <subject>

<body>

<footer>
\`\`\`

## 示例

\`\`\`
feat(auth): 添加 JWT 令牌刷新功能

- 实现自动令牌刷新逻辑
- 添加刷新令牌存储
- 更新 API 调用拦截器

Closes #123
\`\`\`
`
    },
    {
        id: 'documentation',
        name: '文档编写',
        description: '编写技术文档的 Skill',
        filename: 'documentation.md',
        content: `---
description: 技术文档编写 Skill
---

# 文档编写 Skill

帮助用户编写清晰、完整的技术文档。

## 文档结构

1. **概述**
   - 项目/功能简介
   - 适用范围
   - 前置条件

2. **快速开始**
   - 安装步骤
   - 基本用法示例

3. **详细说明**
   - API 参考
   - 配置选项
   - 使用场景

4. **常见问题**
   - FAQ
   - 故障排除

## 写作风格

- 使用简洁明了的语言
- 提供代码示例
- 包含必要的图表和截图
- 保持内容更新
`
    },
    {
        id: 'empty',
        name: '空白模板',
        description: '创建一个空白 Skill 文件',
        filename: 'new-skill.md',
        content: `---
description: 在这里描述你的 Skill
---

# Skill 名称

在这里编写 Skill 的内容...
`
    }
];

/**
 * 注册 Skill 创建命令
 */
export function registerSkillTemplateCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.createSkill', async () => {
            // 选择模板
            const templateItems = SKILL_TEMPLATES.map(t => ({
                label: t.name,
                description: t.description,
                template: t
            }));

            const selected = await vscode.window.showQuickPick(templateItems, {
                placeHolder: '选择 Skill 模板'
            });

            if (!selected) {
                return;
            }

            // 输入文件名
            const filename = await vscode.window.showInputBox({
                prompt: '输入 Skill 文件名（不含扩展名）',
                value: selected.template.filename.replace('.md', ''),
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return '文件名不能为空';
                    }
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return '文件名只能包含字母、数字、下划线和短横线';
                    }
                    return null;
                }
            });

            if (!filename) {
                return;
            }

            // 创建文件
            const warehousePath = getCentralWarehousePath();
            await ensureDirectoryExists(warehousePath);

            const filePath = path.join(warehousePath, `${filename}.md`);

            // 检查文件是否存在
            try {
                await fs.promises.access(filePath);
                const overwrite = await vscode.window.showWarningMessage(
                    `文件 ${filename}.md 已存在，是否覆盖？`,
                    '覆盖', '取消'
                );
                if (overwrite !== '覆盖') {
                    return;
                }
            } catch {
                // 文件不存在，可以创建
            }

            // 写入内容
            await fs.promises.writeFile(filePath, selected.template.content, 'utf-8');

            // 打开文件
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);

            // 刷新 Skills 列表
            vscode.commands.executeCommand('skill-manager.refreshSkills');

            vscode.window.showInformationMessage(`Skill "${filename}.md" 已创建`);
        })
    );
}
