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
            }
        });

        // 初始加载
        this.refresh();
    }

    public async refresh() {
        this._skills = await this._loadSkills();
        this._updateWebview();
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
        const allSkills = await this._loadSkills();
        if (!query) {
            this._skills = allSkills;
        } else {
            const lowerQuery = query.toLowerCase();
            this._skills = allSkills.filter(s =>
                s.name.toLowerCase().includes(lowerQuery) ||
                s.description.toLowerCase().includes(lowerQuery)
            );
        }
        this._updateWebview();
    }

    private async _handleFilter(filter: string) {
        const allSkills = await this._loadSkills();
        switch (filter) {
            case 'installed':
                this._skills = allSkills.filter(s => s.isInstalled);
                break;
            case 'available':
                this._skills = allSkills; // 目前都是本地已安装的
                break;
            default:
                this._skills = allSkills;
        }
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
    <title>Skill Manager</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-foreground);
            padding: 12px;
        }
        .header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
        }
        .header h2 {
            font-size: 14px;
            font-weight: 600;
        }
        .search-box {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 13px;
            margin-bottom: 12px;
        }
        .search-box:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .tab {
            padding: 6px 12px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 4px;
            font-size: 12px;
        }
        .tab:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .stats {
            display: flex;
            gap: 16px;
            margin-bottom: 12px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .stat {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .stat-value {
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .skills-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        .skill-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 12px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .skill-card:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .skill-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 6px;
        }
        .skill-name {
            font-size: 13px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .skill-badge {
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        .skill-badge.installed {
            background: #2ea043;
            color: white;
        }
        .skill-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
        }
        .skill-source {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 6px;
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 32px;
            margin-bottom: 12px;
        }
        .refresh-btn {
            position: absolute;
            top: 12px;
            right: 12px;
            background: transparent;
            border: none;
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
        }
        .refresh-btn:hover {
            background: var(--vscode-toolbar-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="header">
        <h2>🎯 Skills 管理</h2>
    </div>

    <input type="text" class="search-box" id="searchInput" placeholder="搜索技能...">

    <div class="tabs">
        <button class="tab active" data-filter="all">全部</button>
        <button class="tab" data-filter="installed">已安装</button>
    </div>

    <div class="stats">
        <div class="stat">
            <span>已安装:</span>
            <span class="stat-value" id="installedCount">0</span>
        </div>
        <div class="stat">
            <span>总计:</span>
            <span class="stat-value" id="totalCount">0</span>
        </div>
    </div>

    <div class="skills-list" id="skillsList">
        <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <div>加载中...</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        // 搜索
        document.getElementById('searchInput').addEventListener('input', (e) => {
            vscode.postMessage({ type: 'search', query: e.target.value });
        });

        // 过滤标签
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                vscode.postMessage({ type: 'filter', filter: tab.dataset.filter });
            });
        });

        // 接收消息
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateSkills') {
                renderSkills(message.skills);
            }
        });

        function renderSkills(skills) {
            const container = document.getElementById('skillsList');
            document.getElementById('installedCount').textContent = skills.filter(s => s.isInstalled).length;
            document.getElementById('totalCount').textContent = skills.length;

            if (skills.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div>暂无技能</div>
                        <div style="font-size: 12px; margin-top: 8px;">使用命令面板创建新技能</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = skills.map(skill => \`
                <div class="skill-card" data-path="\${skill.path}">
                    <div class="skill-header">
                        <span class="skill-name">\${skill.name}</span>
                        <span class="skill-badge \${skill.isInstalled ? 'installed' : ''}">\${skill.isInstalled ? '已安装' : '可用'}</span>
                    </div>
                    <div class="skill-description">\${skill.description || '暂无描述'}</div>
                    <div class="skill-source">📁 \${skill.source || 'local'}</div>
                </div>
            \`).join('');

            // 点击打开技能
            container.querySelectorAll('.skill-card').forEach(card => {
                card.addEventListener('click', () => {
                    vscode.postMessage({ type: 'openSkill', path: card.dataset.path });
                });
            });
        }
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
