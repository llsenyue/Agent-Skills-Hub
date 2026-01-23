/**
 * 路径配置 - 管理各 AI 工具的 Skills 路径
 */
import * as os from 'os';
import * as path from 'path';

export interface ToolPathConfig {
    name: string;
    id: string;
    getPath: () => string;
    description: string;
}

/**
 * 获取用户主目录
 */
export function getHomeDir(): string {
    return os.homedir();
}

/**
 * 获取中央仓库路径
 */
export function getCentralWarehousePath(): string {
    return path.join(getHomeDir(), '.agent', 'skills');
}

/**
 * 各工具的 Skills 路径配置
 */
export const TOOL_PATHS: ToolPathConfig[] = [
    {
        name: 'Gemini CLI',
        id: 'gemini-cli',
        getPath: () => path.join(getHomeDir(), '.gemini', 'skills'),
        description: 'Google Gemini CLI 的 Skills 目录'
    },
    {
        name: 'Antigravity (Global)',
        id: 'antigravity-global',
        getPath: () => path.join(getHomeDir(), '.gemini', 'antigravity', 'skills'),
        description: 'Antigravity 全局 Skills 目录'
    },
    {
        name: 'Windsurf',
        id: 'windsurf',
        getPath: () => path.join(getHomeDir(), '.codeium', 'windsurf', 'skills'),
        description: 'Windsurf AI 的 Skills 目录'
    },
    {
        name: 'Claude Code',
        id: 'claude-code',
        getPath: () => {
            if (process.platform === 'win32') {
                return path.join(process.env.APPDATA || '', 'claude', 'skills');
            } else if (process.platform === 'darwin') {
                return path.join(getHomeDir(), 'Library', 'Application Support', 'claude', 'skills');
            } else {
                return path.join(getHomeDir(), '.config', 'claude', 'skills');
            }
        },
        description: 'Claude Code 的 Skills 目录'
    }
];

/**
 * 根据工具 ID 获取路径配置
 */
export function getToolPathById(id: string): ToolPathConfig | undefined {
    return TOOL_PATHS.find(tool => tool.id === id);
}
