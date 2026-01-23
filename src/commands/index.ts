/**
 * 命令处理器 - 注册和处理 VS Code 命令
 */
import * as vscode from 'vscode';
import {
    initializeCentralWarehouse,
    createSymlinkForTool,
    getAllLinkStatus,
    removeSymlinkForTool
} from '../utils/filesystem';
import { TOOL_PATHS, getCentralWarehousePath } from '../config/paths';

/**
 * 注册所有命令
 */
export function registerCommands(context: vscode.ExtensionContext): void {
    // 初始化中央仓库
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.initWarehouse', async () => {
            try {
                const warehousePath = await initializeCentralWarehouse();
                vscode.window.showInformationMessage(`中央仓库已初始化: ${warehousePath}`);

                // 刷新侧边栏
                vscode.commands.executeCommand('skill-manager.refreshSkills');
            } catch (error) {
                vscode.window.showErrorMessage(`初始化失败: ${(error as Error).message}`);
            }
        })
    );

    // 链接所有工具
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.linkAllTools', async () => {
            const confirm = await vscode.window.showWarningMessage(
                '此操作将把所有 AI 工具的 Skills 目录链接到中央仓库。现有目录将被备份。是否继续?',
                '确认', '取消'
            );

            if (confirm !== '确认') {
                return;
            }

            const results: string[] = [];
            for (const tool of TOOL_PATHS) {
                try {
                    await createSymlinkForTool(tool.id, true);
                    results.push(`✅ ${tool.name}: 链接成功`);
                } catch (error) {
                    results.push(`❌ ${tool.name}: ${(error as Error).message}`);
                }
            }

            vscode.window.showInformationMessage(results.join('\n'), { modal: true });
        })
    );

    // 链接单个工具
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.linkTool', async () => {
            const toolItems = TOOL_PATHS.map(tool => ({
                label: tool.name,
                description: tool.getPath(),
                id: tool.id
            }));

            const selected = await vscode.window.showQuickPick(toolItems, {
                placeHolder: '选择要链接的工具'
            });

            if (!selected) {
                return;
            }

            try {
                await createSymlinkForTool(selected.id, true);
                vscode.window.showInformationMessage(`${selected.label} 已成功链接到中央仓库`);
            } catch (error) {
                vscode.window.showErrorMessage(`链接失败: ${(error as Error).message}`);
            }
        })
    );

    // 查看链接状态
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.showStatus', async () => {
            const statuses = await getAllLinkStatus();
            const centralPath = getCentralWarehousePath();

            const statusLines = [
                `📦 中央仓库: ${centralPath}`,
                '',
                '工具链接状态:',
                ...statuses.map(s => {
                    if (!s.exists) {
                        return `⚪ ${s.toolName}: 未配置`;
                    } else if (s.isSymlink) {
                        return `🔗 ${s.toolName}: 已链接 → ${s.linkedTo}`;
                    } else {
                        return `📁 ${s.toolName}: 独立目录 (未链接)`;
                    }
                })
            ];

            vscode.window.showInformationMessage(statusLines.join('\n'), { modal: true });
        })
    );

    // 打开中央仓库目录
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.openWarehouse', async () => {
            const warehousePath = getCentralWarehousePath();
            const uri = vscode.Uri.file(warehousePath);

            try {
                await vscode.commands.executeCommand('revealFileInOS', uri);
            } catch {
                vscode.window.showErrorMessage(`无法打开目录: ${warehousePath}`);
            }
        })
    );

    // 取消工具链接
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.unlinkTool', async () => {
            const statuses = await getAllLinkStatus();
            const linkedTools = statuses.filter(s => s.isSymlink);

            if (linkedTools.length === 0) {
                vscode.window.showInformationMessage('没有已链接的工具');
                return;
            }

            const toolItems = linkedTools.map(s => ({
                label: s.toolName,
                description: `链接到: ${s.linkedTo}`,
                id: s.toolId
            }));

            const selected = await vscode.window.showQuickPick(toolItems, {
                placeHolder: '选择要取消链接的工具'
            });

            if (!selected) {
                return;
            }

            try {
                await removeSymlinkForTool(selected.id);
                vscode.window.showInformationMessage(`${selected.label} 链接已移除`);
            } catch (error) {
                vscode.window.showErrorMessage(`取消链接失败: ${(error as Error).message}`);
            }
        })
    );
}
