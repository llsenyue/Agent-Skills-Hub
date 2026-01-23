/**
 * Skill Manager Extension - 主入口
 * 管理 AI Agent Skills 和本地环境配置
 */
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { registerSkillsTreeView } from './views/skillsTree';
import { registerToolsTreeView } from './views/toolsTree';
import { registerSkillsWebviewView } from './views/skillsWebview';
import { registerSkillsPanel } from './views/skillsPanel';
import { registerSkillTemplateCommands } from './templates';
import { initializeCentralWarehouse } from './utils/filesystem';
import { checkAllSourcesForUpdates } from './utils/skillSources';

// 定时器 ID，用于清理
let updateCheckTimeout: ReturnType<typeof setTimeout> | undefined;
let updateCheckInterval: ReturnType<typeof setInterval> | undefined;

// 配置：首次检查延迟 2 分钟，之后每 4 小时检查一次
const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000;      // 2 分钟
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;    // 4 小时

/**
 * 静默检查来源更新
 */
async function silentCheckForUpdates() {
	try {
		console.log('[Skill Manager] 开始静默检查来源更新...');
		const result = await checkAllSourcesForUpdates();
		if (result.updatesAvailable > 0) {
			console.log(`[Skill Manager] 发现 ${result.updatesAvailable} 个来源有更新`);
			// 可选：显示状态栏提示（不打扰用户）
			vscode.window.setStatusBarMessage(
				`$(cloud-download) ${result.updatesAvailable} 个技能来源有更新`,
				10000 // 10 秒后自动消失
			);
		} else {
			console.log('[Skill Manager] 所有来源已是最新');
		}
	} catch (error) {
		console.error('[Skill Manager] 静默检查更新失败:', error);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	console.log('Skill Manager 扩展已激活');

	// 注册命令
	registerCommands(context);

	// 注册模板命令
	registerSkillTemplateCommands(context);

	// 注册侧边栏视图
	registerSkillsTreeView(context);
	registerToolsTreeView(context);

	// 注册 Webview 面板（用于 viewsContainers 支持的编辑器）
	registerSkillsWebviewView(context);

	// 注册命令式管理面板（Antigravity 兼容方案）
	registerSkillsPanel(context);

	// 自动初始化中央仓库（静默模式）
	try {
		await initializeCentralWarehouse();
	} catch (error) {
		console.error('初始化中央仓库失败:', error);
	}

	// 设置自动定期检查来源更新
	// 首次检查：2 分钟后
	updateCheckTimeout = setTimeout(() => {
		silentCheckForUpdates();
		// 之后每 4 小时检查一次
		updateCheckInterval = setInterval(silentCheckForUpdates, CHECK_INTERVAL_MS);
	}, FIRST_CHECK_DELAY_MS);

	// 显示欢迎信息
	vscode.window.showInformationMessage(
		'Skill Manager 已就绪。使用命令面板 (Ctrl+Shift+P) 搜索 "Skill Manager" 开始使用。'
	);
}

export function deactivate() {
	console.log('Skill Manager 扩展已停用');

	// 清理定时器
	if (updateCheckTimeout) {
		clearTimeout(updateCheckTimeout);
		updateCheckTimeout = undefined;
	}
	if (updateCheckInterval) {
		clearInterval(updateCheckInterval);
		updateCheckInterval = undefined;
	}
}
