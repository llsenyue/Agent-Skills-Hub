/**
 * 工具链接树视图提供者 - 显示各工具的链接状态
 */
import * as vscode from 'vscode';
import { detectTools, linkTool, SUPPORTED_TOOLS, ToolStatus } from '../utils/toolPaths';
import { getCentralWarehousePath } from '../config/paths';

export class ToolTreeItem extends vscode.TreeItem {
    constructor(
        public readonly status: ToolStatus
    ) {
        super(status.tool.name, vscode.TreeItemCollapsibleState.None);

        this.description = this.getDescription();
        this.iconPath = this.getIcon();
        this.tooltip = this.getTooltip();
        this.contextValue = 'tool';

        // 点击时链接工具
        if (!status.isLinked) {
            this.command = {
                command: 'skill-manager.linkToolById',
                title: '链接工具',
                arguments: [status.tool.id]
            };
        }
    }

    private getDescription(): string {
        if (!this.status.isInstalled) {
            return '未安装';
        } else if (this.status.isLinked) {
            return '已链接';
        } else {
            return '独立目录';
        }
    }

    private getIcon(): vscode.ThemeIcon {
        if (!this.status.isInstalled) {
            return new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
        } else if (this.status.isLinked) {
            return new vscode.ThemeIcon('link', new vscode.ThemeColor('charts.green'));
        } else {
            return new vscode.ThemeIcon('folder', new vscode.ThemeColor('charts.yellow'));
        }
    }

    private getTooltip(): string {
        const lines = [
            `工具: ${this.status.tool.name}`,
            `路径: ${this.status.currentPath || '未检测到'}`
        ];

        if (this.status.isLinked && this.status.linkTarget) {
            lines.push(`链接到: ${this.status.linkTarget}`);
        }

        return lines.join('\n');
    }
}

export class ToolsTreeDataProvider implements vscode.TreeDataProvider<ToolTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ToolTreeItem | undefined | null | void> =
        new vscode.EventEmitter<ToolTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ToolTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ToolTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<ToolTreeItem[]> {
        // 使用 unified detectTools 逻辑
        const statuses = await detectTools();
        return statuses.map(status => new ToolTreeItem(status));
    }
}

/**
 * 注册工具链接视图
 */
export function registerToolsTreeView(context: vscode.ExtensionContext): ToolsTreeDataProvider {
    const treeDataProvider = new ToolsTreeDataProvider();

    const treeView = vscode.window.createTreeView('skillManagerTools', {
        treeDataProvider,
        showCollapseAll: false
    });

    context.subscriptions.push(treeView);

    // 注册按 ID 链接工具的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.linkToolById', async (toolId: string) => {
            const tool = SUPPORTED_TOOLS.find(t => t.id === toolId);

            if (!tool) {
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                `将 ${tool.name} 链接到中央仓库？现有 Skills 将被迁移。`,
                '确认', '取消'
            );

            if (confirm !== '确认') {
                return;
            }

            try {
                const warehousePath = getCentralWarehousePath();
                await linkTool(toolId, warehousePath);

                vscode.window.showInformationMessage(`${tool.name} 已成功链接`);
                treeDataProvider.refresh();
                // 同时也刷新 Webview
                vscode.commands.executeCommand('skill-manager.refreshSkills');
            } catch (error) {
                vscode.window.showErrorMessage(`链接失败: ${(error as Error).message}`);
            }
        })
    );

    // 刷新工具列表命令
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.refreshTools', () => {
            treeDataProvider.refresh();
        })
    );

    return treeDataProvider;
}
