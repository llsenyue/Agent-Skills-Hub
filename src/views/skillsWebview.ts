/**
 * Skills Webview 视图提供者 - 富 UI 管理界面
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCentralWarehousePath } from '../config/paths';
import { pathExists } from '../utils/filesystem';

interface SkillInfo {
    name: string;
    description: string;
    path: string;
    isInstalled: boolean;
    source?: string;
}

export class SkillsWebviewViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'skillManager.mainView';

    private _view?: vscode.WebviewView;
    private _skills: SkillInfo[] = [];
    private _allSkills: SkillInfo[] = [];
    private _currentFilter: 'all' | 'installed' | 'available' = 'all';
    private _currentSearchQuery: string = '';

    constructor(private readonly _extensionUri: vscode.Uri) { }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // 处理来自 webview 的消息
        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'refresh':
                    await this.refresh();
                    break;
                case 'search':
                    await this._handleSearch(data.query);
                    break;
                case 'filter':
                    await this._handleFilter(data.filter);
                    break;
                case 'openSkill':
                    this._openSkill(data.path);
                    break;
                case 'openPanel':
                    vscode.commands.executeCommand('skill-manager.openPanel');
                    break;
            }
        });

        // 监听可见性变化，实现“点击即打开 Panel”的效果
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                vscode.commands.executeCommand('skill-manager.openPanel');
            }
        });

        // 初始加载时也尝试打开
        vscode.commands.executeCommand('skill-manager.openPanel');

        // 初始加载数据
        this.refresh();
    }

    public async refresh() {
        this._allSkills = await this._loadSkills();
        this._applyFilters();
    }

    private async _loadSkills(): Promise<SkillInfo[]> {
        const skills: SkillInfo[] = [];
        const warehousePath = getCentralWarehousePath();

        if (!await pathExists(warehousePath)) {
            return skills;
        }

        try {
            const entries = await fs.promises.readdir(warehousePath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.md')) {
                    const filePath = path.join(warehousePath, entry.name);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    const description = this._extractDescription(content);

                    skills.push({
                        name: entry.name.replace('.md', ''),
                        description,
                        path: filePath,
                        isInstalled: true,
                        source: 'local'
                    });
                } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
                    // 检查目录中的 SKILL.md 或 README.md
                    const dirPath = path.join(warehousePath, entry.name);
                    const skillMd = path.join(dirPath, 'SKILL.md');
                    const readmeMd = path.join(dirPath, 'README.md');

                    let description = '';
                    if (await pathExists(skillMd)) {
                        const content = await fs.promises.readFile(skillMd, 'utf-8');
                        description = this._extractDescription(content);
                    } else if (await pathExists(readmeMd)) {
                        const content = await fs.promises.readFile(readmeMd, 'utf-8');
                        description = this._extractDescription(content);
                    }

                    skills.push({
                        name: entry.name,
                        description,
                        path: dirPath,
                        isInstalled: true,
                        source: 'local'
                    });
                }
            }
        } catch (error) {
            console.error('加载 Skills 失败:', error);
        }

        return skills;
    }

    private _extractDescription(content: string): string {
        // 尝试从 YAML frontmatter 或第一段提取描述
        const lines = content.split('\n');
        let inFrontmatter = false;
        let description = '';

        for (const line of lines) {
            if (line.trim() === '---') {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            if (inFrontmatter && line.startsWith('description:')) {
                description = line.replace('description:', '').trim();
                break;
            }
            if (!inFrontmatter && line.trim() && !line.startsWith('#')) {
                description = line.trim().substring(0, 100);
                if (line.length > 100) {
                    description += '...';
                }
                break;
            }
        }

        return description;
    }

    private async _handleSearch(query: string) {
        this._currentSearchQuery = query;
        this._applyFilters();
    }

    private async _handleFilter(filter: string) {
        this._currentFilter = filter as 'all' | 'installed' | 'available';
        this._applyFilters();
    }

    /**
     * 统一应用筛选和搜索逻辑
     */
    private _applyFilters() {
        if (this._allSkills.length === 0) {
            this._updateWebview();
            return;
        }

        let filtered = [...this._allSkills];

        // 1. 应用类别筛选
        if (this._currentFilter === 'installed') {
            filtered = filtered.filter(s => s.isInstalled);
        }

        // 2. 应用搜索关键词过滤和排序
        if (this._currentSearchQuery && this._currentSearchQuery.trim() !== '') {
            const terms = this._currentSearchQuery.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);

            // 过滤
            filtered = filtered.filter(s => {
                const name = s.name.toLowerCase();
                const desc = s.description.toLowerCase();

                return terms.every(term =>
                    name.includes(term) ||
                    desc.includes(term)
                );
            });

            // 计分排序
            filtered.sort((a, b) => {
                const getScore = (skill: SkillInfo) => {
                    const name = skill.name.toLowerCase();
                    const allInName = terms.every(term => name.includes(term));
                    if (allInName) { return 100; }

                    const anyInName = terms.some(term => name.includes(term));
                    if (anyInName) { return 50; }

                    return 0;
                };

                const scoreA = getScore(a);
                const scoreB = getScore(b);

                if (scoreA !== scoreB) {
                    return scoreB - scoreA;
                }
                return a.name.localeCompare(b.name, 'zh-CN');
            });
        } else {
            // 没有搜索词时按名称排序
            filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        }

        this._skills = filtered;
        this._updateWebview();
    }


    private _openSkill(skillPath: string) {
        const uri = vscode.Uri.file(skillPath);
        vscode.commands.executeCommand('vscode.open', uri);
    }

    private _updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateSkills',
                skills: this._skills
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent Skills Hub</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
            padding: 20px;
            margin: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
        }
        .loading-text {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 20px;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
        }
        .btn-launch {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            width: 100%;
            transition: background 0.2s;
        }
        .btn-launch:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .hint {
            margin-top: 20px;
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
            line-height: 1.4;
        }
    </style>
</head>
<body>
    <div style="font-size: 48px; margin-bottom: 16px;">🚀</div>
    
    <div class="loading-text">正在为您打开管理面板...</div>

    <button class="btn-launch" id="openPanelBtn">
        打开管理面板
    </button>

    <div class="hint">
        点击左侧图标会自动聚焦主面板。<br>
        如果未弹出，请点击上方按钮。
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // 尝试自动触发
        vscode.postMessage({ type: 'openPanel' });

        document.getElementById('openPanelBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'openPanel' });
        });

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateSkills') {
                // 保留接收消息的能力，防止报错
            }
        });
    </script>
</body>
</html>`;
    }
}

/**
 * 注册 Skills Webview 视图
 */
export function registerSkillsWebviewView(context: vscode.ExtensionContext): SkillsWebviewViewProvider {
    const provider = new SkillsWebviewViewProvider(context.extensionUri);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SkillsWebviewViewProvider.viewType,
            provider
        )
    );

    return provider;
}
