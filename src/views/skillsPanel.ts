/**
 * Skills Webview Panel - 独立编辑器标签页形式的管理界面
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getCentralWarehousePath } from '../config/paths';
import { pathExists } from '../utils/filesystem';
import { detectTools, linkTool, unlinkTool, ToolStatus } from '../utils/toolPaths';
import { getSkillSources, addSkillSource, removeSkillSource, syncSource, syncAllSources, SkillSource, getSourcesStatus, checkAllSourcesForUpdates } from '../utils/skillSources';
import { scanAllSkills, enableSkill, disableSkill, migrateToNewStructure, SkillInfo as WarehouseSkillInfo, getSkillsPath, getDisabledPath } from '../utils/skillWarehouse';
import { getSkillNote, setSkillNote, getAllNotes, deleteSkillNote } from '../utils/skillNotes';
import {
    MarketplaceSkill,
    loadMarketplaceSkills,
    searchMarketplaceSkills,
    getTopSkills,
    installMarketplaceSkill,
    isSkillInstalled,
    formatStars
} from '../utils/skillMarketplace';

interface SkillInfo {
    name: string;
    description: string;
    path: string;
    isInstalled: boolean;
    isEnabled: boolean;     // 是否已激活
    source?: string;
    note?: string;          // 备注
}

export class SkillsWebviewPanel {
    public static currentPanel: SkillsWebviewPanel | undefined;
    public static readonly viewType = 'skillManagerPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _skills: SkillInfo[] = [];
    private _allSkills: SkillInfo[] = [];  // 用于统计的完整列表
    private _tools: ToolStatus[] = [];
    private _marketplaceSkills: MarketplaceSkill[] = [];  // 市场技能列表
    private _filteredMarketplaceSkills: MarketplaceSkill[] = [];  // 筛选后的市场技能
    private _marketplaceLoading: boolean = false;  // 市场加载状态
    private _marketplaceLoadError: boolean = false;  // 市场加载是否出错
    private _totalInDatabase: number = 0;  // 数据库中的总技能数
    private _currentPage: number = 1;  // 当前页码
    private _pageSize: number = 200;  // 每页数量
    private _currentMainView: 'mySkills' | 'marketplace' = 'mySkills';  // 当前主视图
    private _currentFilter: 'all' | 'enabled' | 'disabled' = 'all';  // 当前筛选状态
    private _currentLanguage: 'zh' | 'en' = 'zh';  // 当前语言

    private readonly _i18n = {
        zh: {
            appTitle: 'Agent Skills Hub',
            mySkills: '📚 我的技能',
            marketplace: '🛒 技能市场',
            toolsConfig: '🛠️ 工具配置',
            refresh: '刷新',
            importGithub: '从 GitHub 导入',
            searchPlaceholder: '🔍 搜索技能...',
            all: '全部',
            enabled: '已激活',
            disabled: '待激活',
            enabledCount: '已激活',
            totalCount: '总计',
            loading: '加载中...',
            toolsStatus: '🛠️ 工具链接状态',
            githubSources: '🔗 GitHub 来源管理',
            checkUpdates: '🔍 检查更新',
            searchMarketplacePlaceholder: '🔍 搜索市场技能...',
            showing: '显示',
            total: '共',
            databaseTotal: '数据库共',
            install: '📥 安装',
            installed: '✅ 已安装',
            delete: '🗑️ 删除',
            toggleEnabled: '● 已激活',
            toggleDisabled: '○ 待激活',
            noDesc: '暂无描述',
            emptyState: '暂无技能',
            nextPage: '下一页 ▶',
            prevPage: '◀ 上一页',
            page: '页',
            sync: '🔄 同步',
            deleteSource: '🗑️ 删除',
            linked: '● 已链接',
            unlinked: '○ 未链接',
            link: '链接',
            unlink: '断开链接',
            units: '个',
            enable: '激活',
            disable: '禁用',
            emptySources: '📭 暂无 GitHub 来源',
            addSourceHint: '点击 "从 GitHub 导入" 添加来源',
            neverSynced: '从未同步',
            updateAvailable: '有更新',
            notInstalled: '未安装',
            toolNotDetected: '未检测到工具',
            pathNotDetected: '未检测到路径',
            linkedStatus: '已链接 ✅',
            unlinkedStatus: '未链接 ⚠️',
            linkToHub: '链接到中央仓'
        },
        en: {
            appTitle: 'Agent Skills Hub',
            mySkills: '📚 My Skills',
            marketplace: '🛒 Marketplace',
            toolsConfig: '🛠️ Tools Config',
            refresh: 'Refresh',
            importGithub: 'Import GitHub',
            searchPlaceholder: '🔍 Search skills...',
            all: 'All',
            enabled: 'Enabled',
            disabled: 'Disabled',
            enabledCount: 'Enabled',
            totalCount: 'Total',
            loading: 'Loading...',
            toolsStatus: '🛠️ Tool Links',
            githubSources: '🔗 GitHub Sources',
            checkUpdates: '🔍 Check Updates',
            searchMarketplacePlaceholder: '🔍 Search marketplace...',
            showing: 'Showing',
            total: 'Total',
            databaseTotal: 'Database Total',
            install: '📥 Install',
            installed: '✅ Installed',
            delete: '🗑️ Delete',
            toggleEnabled: '● Enabled',
            toggleDisabled: '○ Disabled',
            noDesc: 'No description',
            emptyState: 'No skills found',
            nextPage: 'Next ▶',
            prevPage: '◀ Prev',
            page: 'Page',
            sync: '🔄 Sync',
            deleteSource: '🗑️ Delete',
            linked: '● Linked',
            unlinked: '○ Unlinked',
            link: 'Link',
            unlink: 'Unlink',
            units: '',
            enable: 'Enable',
            disable: 'Disable',
            emptySources: '📭 No GitHub Sources',
            addSourceHint: 'Click "Import GitHub" to add source',
            neverSynced: 'Never synced',
            updateAvailable: 'Update available',
            notInstalled: 'Not Installed',
            toolNotDetected: 'Tool not detected',
            pathNotDetected: 'Path not detected',
            linkedStatus: 'Linked ✅',
            unlinkedStatus: 'Unlinked ⚠️',
            linkToHub: 'Link to Hub'
        }
    };

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // 如果已经存在面板，显示它
        if (SkillsWebviewPanel.currentPanel) {
            SkillsWebviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        // 否则创建新面板
        const panel = vscode.window.createWebviewPanel(
            SkillsWebviewPanel.viewType,
            'Agent Skills Hub',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        SkillsWebviewPanel.currentPanel = new SkillsWebviewPanel(panel, extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // 设置 HTML 内容
        this._update();

        // 监听面板关闭
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // 监听来自 webview 的消息
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'refresh':
                        await this._refresh();
                        break;
                    case 'search':
                        await this._handleSearch(message.query);
                        break;
                    case 'filter':
                        await this._handleFilter(message.filter);
                        break;
                    case 'openSkill':
                        this._openSkill(message.path);
                        break;
                    case 'linkTool':
                        await this._handleLinkTool(message.toolId);
                        break;
                    case 'unlinkTool':
                        await this._handleUnlinkTool(message.toolId);
                        break;
                    case 'addGitHubSource':
                        await this._handleAddGitHubSource();
                        break;
                    case 'removeSource':
                        await this._handleRemoveSource(message.sourceId);
                        break;
                    case 'syncSource':
                        await this._handleSyncSource(message.sourceId);
                        break;
                    case 'syncAllSources':
                        await this._handleSyncAllSources();
                        break;
                    case 'enableSkill':
                        await this._handleEnableSkill(message.skillName);
                        break;
                    case 'disableSkill':
                        await this._handleDisableSkill(message.skillName);
                        break;
                    case 'editNote':
                        await this._handleEditNote(message.skillName);
                        break;
                    case 'checkUpdates':
                        await this._handleCheckUpdates();
                        break;
                    case 'deleteSkill':
                        await this._handleDeleteSkill(message.skillName, message.isEnabled);
                        break;
                    // 市场相关消息
                    case 'switchToMarketplace':
                        await this._handleSwitchToMarketplace();
                        break;
                    case 'switchToMySkills':
                        this._handleSwitchToMySkills();
                        break;
                    case 'loadMarketplace':
                        await this._handleLoadMarketplace(message.forceRefresh);
                        break;
                    case 'installFromMarketplace':
                        await this._handleInstallFromMarketplace(message.skill);
                        break;
                    case 'searchMarketplace':
                        this._handleSearchMarketplace(message.query);
                        break;
                    case 'deleteMarketplaceSkill':
                        await this._handleDeleteMarketplaceSkill(message.skillName);
                        break;
                    case 'changePage':
                        this._handleChangePage(message.page);
                        break;
                    case 'switchLanguage':
                        this._currentLanguage = message.language;
                        this._update();  // 重新生成 HTML 以应用新语言
                        await this._refresh();  // 重新加载数据
                        break;
                }
            },
            null,
            this._disposables
        );

        // 初始加载
        this._refresh();
    }

    public dispose() {
        SkillsWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _refresh() {
        this._allSkills = await this._loadSkills();

        // 根据当前筛选状态重新应用筛选
        switch (this._currentFilter) {
            case 'enabled':
                this._skills = this._allSkills.filter(s => s.isEnabled);
                break;
            case 'disabled':
                this._skills = this._allSkills.filter(s => !s.isEnabled);
                break;
            default:
                this._skills = this._allSkills;
        }

        this._tools = await detectTools();
        this._updateWebview();
    }

    private async _handleLinkTool(toolId: string) {
        try {
            const warehousePath = getCentralWarehousePath();
            await linkTool(toolId, warehousePath);
            vscode.window.showInformationMessage('工具链接成功！');
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`工具链接失败: ${error}`);
        }
    }

    private async _handleUnlinkTool(toolId: string) {
        try {
            const warehousePath = getCentralWarehousePath();

            // 显示确认对话框
            const syncOption = await vscode.window.showQuickPick(
                [
                    { label: '$(sync) 同步并断开', description: '将中央仓库的 Skills 复制到工具目录后断开', value: true },
                    { label: '$(trash) 仅断开链接', description: '直接断开，不保留本地副本', value: false },
                    { label: '$(close) 取消', description: '不执行任何操作', value: null }
                ],
                {
                    placeHolder: '断开链接前，是否将 Skills 同步到工具本地目录？',
                    title: '断开工具链接'
                }
            );

            if (syncOption === undefined || syncOption.value === null) {
                return; // 用户取消
            }

            await unlinkTool(toolId, warehousePath, syncOption.value);

            if (syncOption.value) {
                vscode.window.showInformationMessage('已同步 Skills 并断开链接');
            } else {
                vscode.window.showInformationMessage('工具链接已断开');
            }
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`断开链接失败: ${error}`);
        }
    }

    private async _handleAddGitHubSource() {
        const url = await vscode.window.showInputBox({
            prompt: '输入 GitHub 仓库地址',
            placeHolder: '例如: https://github.com/JimLiu/baoyu-skills 或 JimLiu/baoyu-skills',
            title: '添加 GitHub Skills 来源'
        });

        if (!url) { return; }

        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在导入 Skills...',
                cancellable: false
            }, async () => {
                const source = await addSkillSource(url);
                vscode.window.showInformationMessage(`成功导入来源: ${source.name}`);
            });
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`添加来源失败: ${error}`);
        }
    }

    private async _handleRemoveSource(sourceId: string) {
        const confirm = await vscode.window.showWarningMessage(
            `确定要删除来源 "${sourceId}" 吗？这不会删除已导入的 Skills。`,
            { modal: true },
            '删除'
        );

        if (confirm !== '删除') { return; }

        try {
            await removeSkillSource(sourceId);
            vscode.window.showInformationMessage(`已删除来源: ${sourceId}`);
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`删除来源失败: ${error}`);
        }
    }

    private async _handleSyncSource(sourceId: string) {
        try {
            const sources = await getSkillSources();
            const source = sources.find(s => s.id === sourceId);
            if (!source) {
                throw new Error(`来源 ${sourceId} 不存在`);
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在同步 ${source.name}...`,
                cancellable: false
            }, async () => {
                const result = await syncSource(source);
                vscode.window.showInformationMessage(`同步完成: 新增 ${result.added}, 更新 ${result.updated}`);
            });
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`同步失败: ${error}`);
        }
    }

    private async _handleSyncAllSources() {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在同步所有来源...',
                cancellable: false
            }, async () => {
                const result = await syncAllSources();
                vscode.window.showInformationMessage(`同步完成: ${result.success} 个成功, ${result.failed} 个失败`);
            });
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`同步失败: ${error}`);
        }
    }

    private async _handleEnableSkill(skillName: string) {
        try {
            await enableSkill(skillName);
            vscode.window.showInformationMessage(`已激活: ${skillName}`);
            await this._refresh();
            // 同时刷新市场视图（如果用户在市场界面操作）
            await this._updateMarketplaceWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`激活失败: ${error}`);
        }
    }

    private async _handleDisableSkill(skillName: string) {
        try {
            await disableSkill(skillName);
            vscode.window.showInformationMessage(`已禁用: ${skillName}`);
            await this._refresh();
            // 同时刷新市场视图（如果用户在市场界面操作）
            await this._updateMarketplaceWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`禁用失败: ${error}`);
        }
    }

    private async _handleEditNote(skillName: string) {
        try {
            const currentNote = await getSkillNote(skillName);
            const note = await vscode.window.showInputBox({
                prompt: `编辑 "${skillName}" 的备注`,
                value: currentNote || '',
                placeHolder: '输入备注内容...'
            });

            if (note !== undefined) {
                await setSkillNote(skillName, note);
                vscode.window.showInformationMessage('备注已保存');
                await this._refresh();
            }
        } catch (error) {
            vscode.window.showErrorMessage(`保存备注失败: ${error}`);
        }
    }

    private async _handleCheckUpdates() {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在检查来源更新...',
                cancellable: false
            }, async () => {
                const result = await checkAllSourcesForUpdates();
                if (result.updatesAvailable > 0) {
                    vscode.window.showInformationMessage(`发现 ${result.updatesAvailable} 个来源有更新`);
                } else {
                    vscode.window.showInformationMessage('所有来源已是最新');
                }
            });
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`检查更新失败: ${error}`);
        }
    }

    private async _handleDeleteSkill(skillName: string, isEnabled: boolean) {
        try {
            const skillsPath = getSkillsPath();
            const disabledPath = getDisabledPath();

            // 根据技能状态确定实际路径
            const skillPath = isEnabled
                ? path.join(skillsPath, skillName)
                : path.join(disabledPath, skillName);

            if (!fs.existsSync(skillPath)) {
                vscode.window.showErrorMessage(`技能目录不存在: ${skillName}`);
                return;
            }

            // 删除技能目录
            await fs.promises.rm(skillPath, { recursive: true, force: true });

            // 同时删除备注（如果有的话）
            deleteSkillNote(skillName);

            vscode.window.showInformationMessage(`已删除技能: ${skillName}`);
            await this._refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`删除技能失败: ${error}`);
        }
    }

    private async _handleDeleteMarketplaceSkill(skillName: string) {
        try {
            const skillsPath = getSkillsPath();
            const disabledPath = getDisabledPath();

            // 尝试两个位置
            let skillPath = path.join(skillsPath, skillName);
            if (!fs.existsSync(skillPath)) {
                skillPath = path.join(disabledPath, skillName);
            }

            if (!fs.existsSync(skillPath)) {
                vscode.window.showErrorMessage(`技能目录不存在: ${skillName}`);
                return;
            }

            // 删除技能目录
            await fs.promises.rm(skillPath, { recursive: true, force: true });

            // 同时删除备注（如果有的话）
            deleteSkillNote(skillName);

            vscode.window.showInformationMessage(`已删除技能: ${skillName}`);

            // 刷新本地技能列表并更新市场视图
            await this._refresh();
            await this._updateMarketplaceWebview();
        } catch (error) {
            vscode.window.showErrorMessage(`删除技能失败: ${error}`);
        }
    }

    // ===== 市场相关方法 =====

    private async _handleSwitchToMarketplace() {
        this._currentMainView = 'marketplace';
        // 如果没有数据、之前加载失败、或者正在加载中但超时了，则重新加载
        if (this._marketplaceSkills.length === 0 || this._marketplaceLoadError) {
            // 避免重复加载
            if (!this._marketplaceLoading) {
                await this._handleLoadMarketplace(false);
            }
        } else {
            // 有缓存数据，直接显示
            this._updateMarketplaceWebview();
        }
    }

    private _handleSwitchToMySkills() {
        this._currentMainView = 'mySkills';
        this._updateWebview();
    }

    private async _handleLoadMarketplace(forceRefresh: boolean = false) {
        // 1. 先尝试加载并显示缓存数据（如果有的话）
        const cachedSkills = await loadMarketplaceSkills(false);  // 不强制刷新，只获取缓存

        if (cachedSkills.length > 0 && !forceRefresh) {
            // 立即显示缓存数据
            this._totalInDatabase = cachedSkills.length;
            this._marketplaceSkills = getTopSkills(cachedSkills, 1000);
            this._filteredMarketplaceSkills = this._marketplaceSkills;
            this._currentPage = 1;
            this._marketplaceLoading = false;
            await this._updateMarketplaceWebview();

            // 2. 后台刷新数据（不阻塞UI）
            this._backgroundRefreshMarketplace();
        } else {
            // 没有缓存或强制刷新，显示加载状态
            this._marketplaceLoading = true;
            this._marketplaceLoadError = false;
            this._panel.webview.postMessage({
                type: 'marketplaceLoading',
                loading: true
            });

            try {
                const allSkills = await loadMarketplaceSkills(true);  // 强制从网络获取
                this._totalInDatabase = allSkills.length;
                this._marketplaceSkills = getTopSkills(allSkills, 1000);
                this._filteredMarketplaceSkills = this._marketplaceSkills;
                this._currentPage = 1;
                this._marketplaceLoading = false;
                this._marketplaceLoadError = false;
                await this._updateMarketplaceWebview();
            } catch (error) {
                this._marketplaceLoading = false;
                this._marketplaceLoadError = true;
                vscode.window.showErrorMessage(`加载市场数据失败: ${error}`);
                this._panel.webview.postMessage({
                    type: 'marketplaceLoading',
                    loading: false,
                    error: true
                });
            }
        }
    }

    // 后台刷新市场数据
    private async _backgroundRefreshMarketplace() {
        try {
            const freshSkills = await loadMarketplaceSkills(true);  // 强制从网络获取
            if (freshSkills.length > 0) {
                this._totalInDatabase = freshSkills.length;
                this._marketplaceSkills = getTopSkills(freshSkills, 1000);
                this._filteredMarketplaceSkills = this._marketplaceSkills;
                // 静默更新UI
                await this._updateMarketplaceWebview();
            }
        } catch (error) {
            // 后台刷新失败不显示错误，缓存数据仍然可用
            console.log('[Marketplace] 后台刷新失败:', error);
        }
    }

    private async _handleInstallFromMarketplace(skillData: { id: string } | MarketplaceSkill) {
        // 如果只传入了 ID，从缓存中查找完整的技能信息
        let skill: MarketplaceSkill | undefined;
        if ('githubUrl' in skillData && skillData.githubUrl) {
            skill = skillData as MarketplaceSkill;
        } else {
            skill = this._filteredMarketplaceSkills.find(s => s.id === skillData.id);
            if (!skill) {
                skill = this._marketplaceSkills.find(s => s.id === skillData.id);
            }
        }

        if (!skill) {
            vscode.window.showErrorMessage('找不到要安装的技能');
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `正在安装 ${skill.name}...`,
                cancellable: false
            }, async () => {
                const result = await installMarketplaceSkill(skill!);
                if (result.success) {
                    vscode.window.showInformationMessage(result.message);
                    await this._refresh();  // 刷新本地技能列表
                    this._updateMarketplaceWebview();  // 更新安装状态
                } else {
                    vscode.window.showErrorMessage(result.message);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`安装失败: ${error}`);
        }
    }

    private _handleSearchMarketplace(query: string) {
        if (!query || query.trim() === '') {
            this._filteredMarketplaceSkills = this._marketplaceSkills;
        } else {
            this._filteredMarketplaceSkills = searchMarketplaceSkills(this._marketplaceSkills, query);
        }
        this._currentPage = 1;  // 搜索时重置到第一页
        this._updateMarketplaceWebview();
    }

    private _handleChangePage(page: number) {
        const totalPages = Math.ceil(this._filteredMarketplaceSkills.length / this._pageSize);
        if (page >= 1 && page <= totalPages) {
            this._currentPage = page;
            this._updateMarketplaceWebview();
        }
    }

    private async _updateMarketplaceWebview() {
        // 获取已安装的 GitHub URL 列表，用于判断是否已安装
        const sources = await getSkillSources();
        const installedUrls = sources.map(s => s.repoUrl);

        // 获取本地所有技能（包括激活和未激活的），用于按名称匹配和显示状态
        if (this._allSkills.length === 0) {
            this._allSkills = await this._loadSkills();
        }
        // 创建技能名称到激活状态的映射
        const localSkillsStatus: { [key: string]: boolean } = {};
        this._allSkills.forEach(s => {
            localSkillsStatus[s.name.toLowerCase()] = s.isEnabled;
        });

        // 计算分页
        const totalItems = this._filteredMarketplaceSkills.length;
        const totalPages = Math.ceil(totalItems / this._pageSize);
        const startIndex = (this._currentPage - 1) * this._pageSize;
        const endIndex = startIndex + this._pageSize;
        const pageSkills = this._filteredMarketplaceSkills.slice(startIndex, endIndex);

        this._panel.webview.postMessage({
            type: 'updateMarketplace',
            skills: pageSkills,  // 只传递当前页的技能
            totalCount: totalItems,  // 筛选后的总数
            totalInDatabase: this._totalInDatabase,
            loading: this._marketplaceLoading,
            installedUrls: installedUrls,
            localSkillsStatus: localSkillsStatus,  // 本地技能名称到激活状态的映射
            // 分页信息
            pagination: {
                currentPage: this._currentPage,
                totalPages: totalPages,
                pageSize: this._pageSize,
                startIndex: startIndex + 1,
                endIndex: Math.min(endIndex, totalItems)
            }
        });
    }

    private async _loadSkills(): Promise<SkillInfo[]> {
        try {
            // 使用总仓扫描所有 skills
            const warehouseSkills = await scanAllSkills();

            // 获取所有备注
            const allNotes = await getAllNotes();

            return warehouseSkills.map(skill => ({
                name: skill.name,
                description: skill.description,
                path: skill.path,
                isInstalled: true,
                isEnabled: skill.isEnabled,
                source: skill.source,
                note: allNotes[skill.name]?.note || ''
            }));
        } catch (error) {
            console.error('加载 Skills 失败:', error);
            return [];
        }
    }

    private _extractDescription(content: string): string {
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
                s.description.toLowerCase().includes(lowerQuery) ||
                (s.note && s.note.toLowerCase().includes(lowerQuery))
            );
        }
        this._updateWebview();
    }

    private async _handleFilter(filter: string) {
        // 保存筛选状态
        this._currentFilter = filter as 'all' | 'enabled' | 'disabled';

        // 如果 _allSkills 为空，先加载
        if (this._allSkills.length === 0) {
            this._allSkills = await this._loadSkills();
        }

        switch (filter) {
            case 'enabled':
                this._skills = this._allSkills.filter(s => s.isEnabled);
                break;
            case 'disabled':
                this._skills = this._allSkills.filter(s => !s.isEnabled);
                break;
            default:
                this._skills = this._allSkills;
        }
        this._updateWebview();
    }

    private async _openSkill(skillPath: string) {
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        const skillName = path.basename(skillPath);

        // 检查 SKILL.md 是否存在
        if (!fs.existsSync(skillMdPath)) {
            vscode.window.showErrorMessage(`找不到 SKILL.md 文件: ${skillPath}`);
            return;
        }

        // 读取 SKILL.md 内容
        const content = await fs.promises.readFile(skillMdPath, 'utf-8');

        // 创建 Webview 面板，使用文件夹名作为标题
        const panel = vscode.window.createWebviewPanel(
            'skillDetail',
            skillName,  // 使用文件夹名作为标签标题
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        // 渲染 Markdown 内容
        panel.webview.html = this._getSkillDetailHtml(skillName, content);
    }

    private _getSkillDetailHtml(skillName: string, markdownContent: string): string {
        // 简单的 Markdown 渲染 (转换基本语法)
        const htmlContent = markdownContent
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            .replace(/^\*\*\*(.*)\*\*\*/gim, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/gim, '<em>$1</em>')
            .replace(/`([^`]+)`/gim, '<code>$1</code>')
            .replace(/^- (.*$)/gim, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/^---$/gim, '<hr>');

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${skillName}</title>
    <style>
        body {
            font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            padding: 20px 40px;
            line-height: 1.6;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        h1 { color: var(--vscode-textLink-foreground); border-bottom: 2px solid var(--vscode-textLink-foreground); padding-bottom: 10px; }
        h2 { color: var(--vscode-textLink-activeForeground); margin-top: 24px; }
        h3 { margin-top: 20px; }
        code { 
            background: var(--vscode-textCodeBlock-background); 
            padding: 2px 6px; 
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family, monospace);
        }
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 16px;
            border-radius: 8px;
            overflow-x: auto;
        }
        li { margin: 4px 0; }
        hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 20px 0; }
        .frontmatter { 
            background: var(--vscode-textBlockQuote-background); 
            padding: 12px 16px; 
            border-radius: 8px; 
            margin-bottom: 20px;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <h1>📚 ${skillName}</h1>
    <div class="content">
        <p>${htmlContent}</p>
    </div>
</body>
</html>`;
    }

    private async _updateWebview() {
        const sources = await getSkillSources();
        this._panel.webview.postMessage({
            type: 'updateData',
            skills: this._skills,
            allSkills: this._allSkills,  // 用于统计
            tools: this._tools,
            sources: sources
        });
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const t = this._i18n[this._currentLanguage];
        return `<!DOCTYPE html>
<html lang="${this._currentLanguage}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${t.appTitle}</title>
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
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            margin: 0 auto;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h1 {
            font-size: 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .search-box {
            width: 100%;
            padding: 10px 14px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-size: 14px;
            margin-bottom: 16px;
        }
        .search-box:focus {
            outline: 2px solid var(--vscode-focusBorder);
        }
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
        }
        .tab {
            padding: 8px 16px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 500;
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
            gap: 24px;
            margin-bottom: 20px;
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
        }
        .stat {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .stat-value {
            font-size: 20px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        .skills-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
            gap: 12px;
        }
        .skill-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            cursor: pointer;
            transition: all 0.15s;
        }
        .skill-card:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
        }
        .skill-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 8px;
        }
        .skill-name {
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .skill-badge {
            font-size: 10px;
            padding: 3px 8px;
            border-radius: 12px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-weight: 500;
        }
        .skill-badge.installed {
            background: #2ea043;
            color: white;
        }
        .skill-badge.enabled {
            background: #2ea043;
            color: white;
        }
        .skill-badge.disabled {
            background: var(--vscode-disabledForeground);
            color: var(--vscode-editor-background);
        }
        .skill-card.disabled {
            opacity: 0.7;
            border-style: dashed;
        }
        .skill-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        .skill-actions .btn {
            flex: 1;
            text-align: center;
        }
        .skill-actions .btn-delete {
            flex: 0 0 auto;
            background: transparent;
            border: 1px solid #f48771;
            color: #f48771;
            padding: 4px 8px;
            opacity: 0;
            transition: opacity 0.15s;
        }
        .skill-card:hover .skill-actions .btn-delete {
            opacity: 1;
        }
        .skill-actions .btn-delete:hover {
            background: #f48771;
            color: white;
        }
        .skill-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.5;
            margin-bottom: 8px;
        }
        .skill-note {
            font-size: 11px;
            color: var(--vscode-textLink-foreground);
            background: var(--vscode-textBlockQuote-background);
            padding: 6px 10px;
            border-radius: 4px;
            margin-bottom: 8px;
            font-style: italic;
        }
        .skill-meta {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            gap: 4px;
        }
        /* Source Card Styles */
        .sources-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 20px;
        }
        .source-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px 16px;
        }
        .source-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        .source-name {
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-textLink-foreground);
        }
        .source-status {
            font-size: 16px;
        }
        .source-info {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
        }
        .source-actions {
            display: flex;
            gap: 8px;
        }
        /* Tool Card Styles */
        .tool-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .tool-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tool-name {
            font-size: 16px;
            font-weight: 600;
        }
        .tool-status {
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--vscode-disabledForeground);
        }
        .status-dot.linked {
            background: #2ea043;
        }
        .status-dot.unlinked {
            background: #d73a49;
        }
        .skills-count {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            margin-right: 8px;
        }
        .tool-path {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-textBlockQuote-background);
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
            font-family: monospace;
        }
        .tool-actions {
            display: flex;
            gap: 8px;
            margin-top: auto;
        }
        .empty-state {
            text-align: center;
            padding: 60px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .empty-state-title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }
        /* Marketplace Styles */
        .main-tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .main-tab {
            padding: 10px 20px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.15s;
        }
        .main-tab:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .main-tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .marketplace-card {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 16px;
            transition: all 0.15s;
        }
        .marketplace-card:hover {
            background: var(--vscode-list-hoverBackground);
            border-color: var(--vscode-focusBorder);
            transform: translateY(-2px);
        }
        .marketplace-card.installed {
            border-color: #2ea043;
        }
        /* 安装按钮悬停切换删除按钮样式 */
        .install-btn-wrapper:hover .install-normal {
            opacity: 0;
        }
        .install-btn-wrapper:hover .install-delete {
            opacity: 1 !important;
        }
        .skill-stars {
            display: flex;
            align-items: center;
            gap: 4px;
            color: #f0c14b;
            font-size: 12px;
        }
        .skill-author {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .skill-author img {
            width: 16px;
            height: 16px;
            border-radius: 50%;
        }
        .marketplace-stats {
            padding: 12px 16px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            margin-bottom: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-foreground);
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 16px 0;
            margin-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .pagination button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎯 ${t.appTitle}</h1>
            <div class="header-actions">
                <button class="btn btn-secondary" id="switchLangBtn">${this._currentLanguage === 'zh' ? 'En' : '中'}</button>
                <button class="btn btn-secondary" id="refreshBtn">🔄 ${t.refresh}</button>
                <button class="btn btn-secondary" id="importGitHubBtn">📦 ${t.importGithub}</button>
            </div>
        </div>

        <!-- 主视图切换 -->
        <div class="main-tabs">
            <button class="main-tab active" id="mySkillsTab" data-main-view="mySkills">${t.mySkills}</button>
            <button class="main-tab" id="marketplaceTab" data-main-view="marketplace">${t.marketplace}</button>
            <button class="main-tab" id="toolsTab" data-main-view="tools">${t.toolsConfig}</button>
        </div>

        <!-- 我的技能视图 -->
        <div id="mySkillsSection">
            <div id="searchContainer">
                <input type="text" class="search-box" id="searchInput" placeholder="${t.searchPlaceholder}">
            </div>

            <div class="tabs">
                <button class="tab active" data-view="skills" data-filter="all">${t.all}</button>
                <button class="tab" data-view="skills" data-filter="enabled">${t.enabled}</button>
                <button class="tab" data-view="skills" data-filter="disabled">${t.disabled}</button>
            </div>

        <div id="skillsView">
            <div class="stats">
                <div class="stat">
                    <span class="stat-label">${t.enabledCount}</span>
                    <span class="stat-value" id="enabledCount">0</span>
                </div>
                <div class="stat">
                    <span class="stat-label">${t.totalCount}</span>
                    <span class="stat-value" id="totalCount">0</span>
                </div>
            </div>

            <div class="skills-grid" id="skillsGrid">
                <div class="empty-state">
                    <div class="empty-state-icon">📦</div>
                    <div>${t.loading}</div>
                </div>
            </div>
        </div>

        </div>
    </div>  <!-- end mySkillsSection -->


    <!-- 工具配置视图 -->
    <div id="toolsSection" style="display: none;">
        <!-- 上方：工具链接状态（2列） -->
        <div style="margin-bottom: 24px;">
            <h3 style="margin-bottom: 16px;">${t.toolsStatus}</h3>
            <div class="skills-grid" id="toolsGrid" style="grid-template-columns: repeat(2, 1fr);">
                <!-- Tools render here -->
            </div>
        </div>
        <!-- 下方：GitHub 来源管理（2列） -->
        <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0;">${t.githubSources}</h3>
                <button class="btn btn-secondary btn-sm" onclick="vscode.postMessage({type: 'checkUpdates'})">${t.checkUpdates}</button>
            </div>
            <div class="sources-list" id="sourcesList" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                <!-- Sources render here -->
            </div>
        </div>
    </div>

    <!-- 技能市场视图 -->
    <!-- 技能市场视图 -->
    <div id="marketplaceSection" style="display: none;">
        <div id="marketplaceSearchContainer">
            <input type="text" class="search-box" id="marketplaceSearchInput" placeholder="${t.searchMarketplacePlaceholder}">
        </div>

        <div class="marketplace-stats">
            <div>
                <span id="marketplaceRangeInfo"></span>
                <span style="margin-left: 8px;">${t.total} <strong id="marketplaceTotalCount">0</strong> ${t.units}</span>
                <span style="margin-left: 16px; color: var(--vscode-descriptionForeground);">
                    (${t.databaseTotal} <strong id="marketplaceDatabaseCount">0</strong> ${t.units})
                </span>
            </div>
            <button class="btn btn-secondary btn-sm" id="refreshMarketplaceBtn">🔄 ${t.refresh}</button>
        </div>

        <div class="skills-grid" id="marketplaceGrid">
            <div class="empty-state">
                <div class="loading-spinner"></div>
                <div style="margin-top: 16px;">${t.loading}</div>
            </div>
        </div>

        <!-- 分页控件 -->
        <div class="pagination" id="paginationContainer" style="display: none;">
            <button class="btn btn-secondary btn-sm" id="prevPageBtn">${t.prevPage}</button>
            <span id="pageInfo" style="margin: 0 16px;"></span>
            <button class="btn btn-secondary btn-sm" id="nextPageBtn">${t.nextPage}</button>
        </div>
    </div>
</div>

    <script>
        const vscode = acquireVsCodeApi();
        const i18n = ${JSON.stringify(t)};
        let currentView = 'skills';
        let currentMainView = 'mySkills';
        let installedUrls = [];  // 已安装的 URL 列表
        let localSkillsStatus = {};  // 技能名称到激活状态的映射

        function switchLanguage() {
            vscode.postMessage({
                type: 'switchLanguage',
                language: '${this._currentLanguage === 'zh' ? 'en' : 'zh'}'
            });
        }

        // 删除技能的全局函数（供内联 onclick 调用）
        function deleteSkill(skillName, isEnabled) {
            if (confirm(\`确定要删除技能 "\${skillName}" 吗？此操作不可撤销。\`)) {
                vscode.postMessage({ type: 'deleteSkill', skillName: skillName, isEnabled: isEnabled });
            }
        }

        // 语言切换按钮
        document.getElementById('switchLangBtn').addEventListener('click', switchLanguage);

        // 刷新按钮
        document.getElementById('refreshBtn').addEventListener('click', () => {
            if (currentMainView === 'mySkills') {
                vscode.postMessage({ type: 'refresh' });
            } else {
                vscode.postMessage({ type: 'loadMarketplace', forceRefresh: true });
            }
        });

        // GitHub 导入按钮
        document.getElementById('importGitHubBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'addGitHubSource' });
        });

        // 搜索
        document.getElementById('searchInput').addEventListener('input', (e) => {
            vscode.postMessage({ type: 'search', query: e.target.value });
        });

        // 市场搜索
        document.getElementById('marketplaceSearchInput').addEventListener('input', (e) => {
            vscode.postMessage({ type: 'searchMarketplace', query: e.target.value });
        });

        // 刷新市场按钮
        document.getElementById('refreshMarketplaceBtn').addEventListener('click', () => {
            vscode.postMessage({ type: 'loadMarketplace', forceRefresh: true });
        });

        // 分页按钮
        let currentPagination = { currentPage: 1, totalPages: 1 };

        document.getElementById('prevPageBtn').addEventListener('click', () => {
            if (currentPagination.currentPage > 1) {
                vscode.postMessage({ type: 'changePage', page: currentPagination.currentPage - 1 });
            }
        });

        document.getElementById('nextPageBtn').addEventListener('click', () => {
            if (currentPagination.currentPage < currentPagination.totalPages) {
                vscode.postMessage({ type: 'changePage', page: currentPagination.currentPage + 1 });
            }
        });

        // 主视图切换
        document.querySelectorAll('.main-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const mainView = tab.dataset.mainView;
                switchMainView(mainView);
            });
        });

        function switchMainView(viewName) {
            currentMainView = viewName;
            
            // 隐藏所有视图
            document.getElementById('mySkillsSection').style.display = 'none';
            document.getElementById('marketplaceSection').style.display = 'none';
            document.getElementById('toolsSection').style.display = 'none';

            if (viewName === 'marketplace') {
                document.getElementById('marketplaceSection').style.display = 'block';
                vscode.postMessage({ type: 'switchToMarketplace' });
            } else if (viewName === 'tools') {
                document.getElementById('toolsSection').style.display = 'block';
                // 切换到工具页面也请求刷新数据，确保状态最新
                vscode.postMessage({ type: 'switchToMySkills' }); 
            } else {
                document.getElementById('mySkillsSection').style.display = 'block';
                vscode.postMessage({ type: 'switchToMySkills' });
            }
        }

        // 标签切换
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const view = tab.dataset.view;
                const filter = tab.dataset.filter;

                // 只有技能视图有过滤器
                if (filter) {
                    vscode.postMessage({ type: 'filter', filter: filter });
                }
            });
        });



        // 接收消息
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.type === 'updateData') {
                renderSkills(message.skills, message.allSkills || message.skills);
                renderTools(message.tools);
                renderSources(message.sources || []);
            } else if (message.type === 'updateMarketplace') {
                installedUrls = message.installedUrls || [];
                localSkillsStatus = message.localSkillsStatus || {};
                renderMarketplaceSkills(message.skills, message.totalCount, message.totalInDatabase, message.loading, message.pagination);
            } else if (message.type === 'marketplaceLoading') {
                if (message.loading) {
                    document.getElementById('marketplaceGrid').innerHTML = \`
                        <div class="empty-state" style="grid-column: 1 / -1;">
                            <div class="loading-spinner"></div>
                            <div style="margin-top: 16px;">正在加载市场数据...</div>
                        </div>
                    \`;
                    document.getElementById('paginationContainer').style.display = 'none';
                }
            }
        });

        function formatStars(stars) {
            if (stars >= 1000) {
                return (stars / 1000).toFixed(1) + 'k';
            }
            return stars.toString();
        }

        // 检查技能安装状态，返回 { installed: boolean, enabled: boolean | null, localName: string | null }
        function getInstallStatus(githubUrl, skillName) {
            const lowerName = skillName ? skillName.toLowerCase() : '';
            // 方式1: 检查技能名称是否已存在于本地（需要找到实际的 key）
            if (lowerName) {
                for (const key in localSkillsStatus) {
                    if (key.toLowerCase() === lowerName) {
                        return { installed: true, enabled: localSkillsStatus[key], localName: key };
                    }
                }
            }
            // 方式2: 检查 URL 是否匹配已安装的来源
            if (githubUrl) {
                const normalizedSkill = githubUrl.replace(/\\.git$/i, '').replace(/\\/$/, '').toLowerCase();
                const urlMatch = installedUrls.some(url => {
                    const normalizedInstalled = url.replace(/\\.git$/i, '').replace(/\\/$/, '').toLowerCase();
                    return normalizedSkill === normalizedInstalled;
                });
                if (urlMatch) return { installed: true, enabled: null, localName: null };
            }
            return { installed: false, enabled: null, localName: null };
        }

        function renderMarketplaceSkills(skills, totalCount, totalInDatabase, loading, pagination) {
            const container = document.getElementById('marketplaceGrid');
            document.getElementById('marketplaceTotalCount').textContent = totalCount || 0;
            document.getElementById('marketplaceDatabaseCount').textContent = totalInDatabase || 0;
            
            // 更新分页信息
            if (pagination) {
                currentPagination = pagination;
                document.getElementById('marketplaceRangeInfo').textContent = 
                    \`显示 \${pagination.startIndex}-\${pagination.endIndex}\`;
                document.getElementById('pageInfo').textContent = 
                    \`第 \${pagination.currentPage} / \${pagination.totalPages} 页\`;
                
                // 显示/隐藏分页控件
                const paginationEl = document.getElementById('paginationContainer');
                paginationEl.style.display = pagination.totalPages > 1 ? 'flex' : 'none';
                
                // 禁用/启用按钮
                document.getElementById('prevPageBtn').disabled = pagination.currentPage <= 1;
                document.getElementById('nextPageBtn').disabled = pagination.currentPage >= pagination.totalPages;
            }
            
            if (loading) {
                container.innerHTML = \`
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="loading-spinner"></div>
                        <div style="margin-top: 16px;">正在加载市场数据...</div>
                    </div>
                \`;
                return;
            }

            if (!skills || skills.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="empty-state-icon">🔍</div>
                        <div class="empty-state-title">未找到技能</div>
                        <div>尝试其他搜索关键词</div>
                    </div>
                \`;
                document.getElementById('paginationContainer').style.display = 'none';
                return;
            }

            container.innerHTML = skills.map(skill => {
                const status = getInstallStatus(skill.githubUrl, skill.name);
                const description = skill.descriptionZh || skill.description || i18n.noDesc;
                const shortDesc = description.length > 80 ? description.substring(0, 80) + '...' : description;
                
                // 根据安装和激活状态显示不同按钮
                let actionButtons = '';
                if (status.installed) {
                    // 已安装：左边显示安装状态（悬停显示删除），右边显示可切换的激活按钮
                    // 使用 localName 确保传递正确的本地技能目录名称
                    const localSkillName = status.localName || skill.name;
                    const installBtn = \`
                        <div class="install-btn-wrapper" style="flex: 1; position: relative;">
                            <button class="btn btn-secondary btn-sm install-normal" style="width: 100%;">\${i18n.installed}</button>
                            <button class="btn btn-sm install-delete" onclick="event.stopPropagation(); deleteMarketplaceSkill('\${localSkillName}')" style="width: 100%; position: absolute; top: 0; left: 0; background: #f48771; color: white; border: none; cursor: pointer; opacity: 0; transition: opacity 0.15s;">\${i18n.delete}</button>
                        </div>
                    \`;
                    let toggleBtn = '';
                    if (status.enabled === true) {
                        toggleBtn = \`<button class="btn btn-sm" onclick="event.stopPropagation(); toggleSkillStatus('\${localSkillName}', true)" style="flex: 1; background: #2ea043; color: white; border: none; cursor: pointer;">\${i18n.toggleEnabled}</button>\`;
                    } else if (status.enabled === false) {
                        toggleBtn = \`<button class="btn btn-sm" onclick="event.stopPropagation(); toggleSkillStatus('\${localSkillName}', false)" style="flex: 1; background: var(--vscode-disabledForeground); color: white; border: none; cursor: pointer;">\${i18n.toggleDisabled}</button>\`;
                    } else {
                        toggleBtn = '<button class="btn btn-secondary btn-sm" disabled style="flex: 1;">-</button>';
                    }
                    actionButtons = installBtn + toggleBtn;
                } else {
                    actionButtons = \`<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); installSkill('\${skill.id}')" style="flex: 1;">\${i18n.install}</button>\`;
                }
                
                return \`
                    <div class="marketplace-card \${status.installed ? 'installed' : ''}" data-skill-id="\${skill.id}">
                        <div class="skill-header">
                            <span class="skill-name">\${skill.name}</span>
                            <span class="skill-stars">⭐ \${formatStars(skill.stars)}</span>
                        </div>
                        <div class="skill-description">\${shortDesc}</div>
                        <div class="skill-author">
                            \${skill.authorAvatar ? \`<img src="\${skill.authorAvatar}" alt="\${skill.author}">\` : '👤'}
                            <span>\${skill.author}</span>
                        </div>
                        <div class="skill-actions" style="margin-top: 12px; display: flex; gap: 8px;">
                            \${actionButtons}
                        </div>
                    </div>
                \`;
            }).join('');
        }

        // 安装技能
        function installSkill(skillId) {
            // 从当前显示的技能中找到对应的技能
            vscode.postMessage({ 
                type: 'installFromMarketplace', 
                skill: { id: skillId }
            });
        }

        // 切换技能激活状态（从市场界面调用）
        function toggleSkillStatus(skillName, currentlyEnabled) {
            if (currentlyEnabled) {
                // 当前是激活状态，点击后禁用
                vscode.postMessage({ type: 'disableSkill', skillName: skillName });
            } else {
                // 当前是禁用状态，点击后激活
                vscode.postMessage({ type: 'enableSkill', skillName: skillName });
            }
        }

        // 从市场界面删除已安装的技能
        function deleteMarketplaceSkill(skillName) {
            // 直接发送消息，后端会弹出 VS Code 原生确认对话框
            vscode.postMessage({ type: 'deleteMarketplaceSkill', skillName: skillName });
        }

        function renderSkills(skills, allSkills) {
            const container = document.getElementById('skillsGrid');
            // 统计使用 allSkills（完整列表）
            document.getElementById('enabledCount').textContent = allSkills.filter(s => s.isEnabled).length;
            document.getElementById('totalCount').textContent = allSkills.length;

            if (skills.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state" style="grid-column: 1 / -1;">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-title">暂无匹配的技能</div>
                        <div>尝试切换筛选条件或从 GitHub 导入</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = skills.map(skill => \`
                <div class="skill-card \${skill.isEnabled ? '' : 'disabled'}" data-path="\${skill.path}" data-name="\${skill.name}">
                    <div class="skill-header">
                        <span class="skill-name">\${skill.name}</span>
                        <span class="skill-badge \${skill.isEnabled ? 'enabled' : 'disabled'}">\${skill.isEnabled ? i18n.enabled : i18n.disabled}</span>
                    </div>
                    <div class="skill-description">\${skill.description || i18n.noDesc}</div>
                    \${skill.note ? \`<div class="skill-note">📝 \${skill.note}</div>\` : ''}
                    <div class="skill-meta">📁 \${skill.source || 'local'}</div>
                    <div class="skill-actions">
                        \${skill.isEnabled 
                            ? \`<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); vscode.postMessage({type: 'disableSkill', skillName: '\${skill.name}'})">\${i18n.disable}</button>\`
                            : \`<button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); vscode.postMessage({type: 'enableSkill', skillName: '\${skill.name}'})">\${i18n.enable}</button>\`
                        }
                        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); vscode.postMessage({type: 'editNote', skillName: '\${skill.name}'})">📝</button>
                        <button class="btn btn-delete btn-sm" onclick="event.stopPropagation(); vscode.postMessage({type: 'deleteSkill', skillName: '\${skill.name}', isEnabled: \${skill.isEnabled}})" title="\${i18n.delete}">✕</button>
                    </div>
                </div>
            \`).join('');

            container.querySelectorAll('.skill-card').forEach(card => {
                card.addEventListener('click', () => {
                    vscode.postMessage({ type: 'openSkill', path: card.dataset.path });
                });
            });
        }

        function renderSources(sources) {
            const container = document.getElementById('sourcesList');
            if (!sources || sources.length === 0) {
                container.innerHTML = \`
                    <div class="empty-state" style="padding: 20px; text-align: center; color: var(--vscode-descriptionForeground);">
                        <div>\${i18n.emptySources}</div>
                        <div style="font-size: 12px; margin-top: 8px;">\${i18n.addSourceHint}</div>
                    </div>
                \`;
                return;
            }

            container.innerHTML = sources.map(source => {
                const statusIcon = source.status === 'synced' ? '✅' : 
                                   source.status === 'updating' ? '🔄' : 
                                   source.status === 'error' ? '❌' : '⏳';
                const lastUpdated = source.lastUpdated ? 
                    new Date(source.lastUpdated).toLocaleString() : i18n.neverSynced;
                
                // 更新徽章
                const updateBadge = source.hasUpdate ? 
                    '<span style="background: #d29922; color: #000; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-left: 8px;">' + i18n.updateAvailable + '</span>' : '';

                return \`
                    <div class="source-card" style="padding: 10px 16px;">
                        <div class="source-header" style="margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span class="source-name" style="font-weight: 600;">\${source.name}\${updateBadge}</span>
                                <span style="font-size: 11px; color: var(--vscode-descriptionForeground);">📦 \${source.skillCount || 0} Skills</span>
                                <span style="font-size: 11px; color: var(--vscode-descriptionForeground);">🕐 \${lastUpdated}</span>
                            </div>
                            <span class="source-status">\${statusIcon}</span>
                        </div>
                        <div class="source-actions" style="display: flex; gap: 8px;">
                            <button class="btn btn-primary btn-sm" onclick="vscode.postMessage({type: 'syncSource', sourceId: '\${source.id}'})">🔄 \${i18n.sync}</button>
                            <button class="btn btn-secondary btn-sm" onclick="vscode.postMessage({type: 'removeSource', sourceId: '\${source.id}'})">\${i18n.deleteSource}</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function renderTools(tools) {
            console.log('[renderTools] Received tools:', JSON.stringify(tools, null, 2));
            const container = document.getElementById('toolsGrid');
            if (!tools || tools.length === 0) {
                 container.innerHTML = \`<div class="empty-state">\${i18n.emptyTools || 'No tools'}</div>\`;
                 return;
            }

            container.innerHTML = tools.map(status => {
                let statusText = i18n.notInstalled;
                let statusClass = '';
                let buttonHtml = '';
                let pathInfo = status.currentPath || i18n.pathNotDetected;

                if (status.isInstalled) {
                    if (status.isLinked) {
                        statusText = i18n.linkedStatus;
                        statusClass = 'linked';
                        buttonHtml = \`<button class="btn btn-secondary btn-sm" onclick="vscode.postMessage({type: 'unlinkTool', toolId: '\${status.tool.id}'})">\${i18n.unlink}</button>\`;
                    } else {
                        statusText = i18n.unlinkedStatus;
                        statusClass = 'unlinked';
                        buttonHtml = \`<button class="btn btn-primary btn-sm" onclick="vscode.postMessage({type: 'linkTool', toolId: '\${status.tool.id}'})">\${i18n.linkToHub}</button>\`;
                    }
                } else {
                    buttonHtml = \`<button class="btn btn-secondary btn-sm" disabled>\${i18n.toolNotDetected}</button>\`;
                }

                return \`
                    <div class="tool-card" style="padding: 10px 16px;">
                        <div class="tool-header" style="margin-bottom: 6px;">
                            <span class="tool-name">\${status.tool.name}</span>
                            <div class="tool-status">
                                <span class="skills-count" title="Skills 数量">\${status.skillsCount} Skills</span>
                                <span class="status-dot \${statusClass}"></span>
                                <span>\${statusText}</span>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            \${buttonHtml}
                            <span class="tool-path" title="\${pathInfo}" style="font-size: 11px; color: var(--vscode-descriptionForeground); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">\${pathInfo}</span>
                        </div>
                    </div>
                \`;
            }).join('');
        }
    </script>
</body>
</html>`;
    }
}

/**
 * 注册打开 Skills 管理面板的命令
 */
export function registerSkillsPanel(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('skill-manager.openPanel', () => {
            SkillsWebviewPanel.createOrShow(context.extensionUri);
        })
    );
}
