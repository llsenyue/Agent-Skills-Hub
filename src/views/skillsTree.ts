/**
 * Skills 树视图提供者 - 在侧边栏显示 Skills 列表
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCentralWarehousePath } from '../config/paths';
import { pathExists } from '../utils/filesystem';

export class SkillTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly resourceUri: vscode.Uri,
        public readonly isDirectory: boolean = false
    ) {
        super(label, collapsibleState);

        if (!isDirectory) {
            this.command = {
                command: 'vscode.open',
                title: '打开 Skill',
                arguments: [resourceUri]
            };
            this.contextValue = 'skill';
            this.iconPath = new vscode.ThemeIcon('file-code');
        } else {
            this.contextValue = 'skillFolder';
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        this.tooltip = resourceUri.fsPath;
    }
}

export class SkillsTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SkillTreeItem | undefined | null | void> =
        new vscode.EventEmitter<SkillTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor() {
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        const warehousePath = getCentralWarehousePath();
        const pattern = new vscode.RelativePattern(warehousePath, '**/*.md');

        this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.fileWatcher.onDidCreate(() => this.refresh());
        this.fileWatcher.onDidDelete(() => this.refresh());
        this.fileWatcher.onDidChange(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: SkillTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
        const warehousePath = getCentralWarehousePath();

        if (!await pathExists(warehousePath)) {
            return [
                new SkillTreeItem(
                    '点击初始化中央仓库',
                    vscode.TreeItemCollapsibleState.None,
                    vscode.Uri.file(warehousePath),
                    false
                )
            ];
        }

        const targetPath = element ? element.resourceUri.fsPath : warehousePath;

        try {
            const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
            const items: SkillTreeItem[] = [];

            // 先添加目录
            for (const entry of entries) {
                if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    const uri = vscode.Uri.file(path.join(targetPath, entry.name));
                    items.push(new SkillTreeItem(
                        entry.name,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        uri,
                        true
                    ));
                }
            }

            // 再添加 Markdown 文件
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const uri = vscode.Uri.file(path.join(targetPath, entry.name));
                    items.push(new SkillTreeItem(
                        entry.name.replace('.md', ''),
                        vscode.TreeItemCollapsibleState.None,
                        uri,
                        false
                    ));
                }
            }

            return items;
        } catch (error) {
            console.error('读取 Skills 目录失败:', error);
            return [];
        }
    }

    dispose(): void {
        this.fileWatcher?.dispose();
    }
}

/**
 * 注册 Skills 树视图
 */
export function registerSkillsTreeView(context: vscode.ExtensionContext): SkillsTreeDataProvider {
    const treeDataProvider = new SkillsTreeDataProvider();

    const treeView = vscode.window.createTreeView('skillManagerSkills', {
        treeDataProvider,
        showCollapseAll: true
    });

    context.subscriptions.push(treeView);
    context.subscriptions.push(treeDataProvider);

    // 注册刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.refreshSkills', () => {
            treeDataProvider.refresh();
        })
    );

    return treeDataProvider;
}
