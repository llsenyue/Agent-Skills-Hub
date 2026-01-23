/**
 * 文件系统工具 - 处理目录创建和符号链接
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getCentralWarehousePath, getToolPathById, TOOL_PATHS } from '../config/paths';

export interface LinkStatus {
    toolId: string;
    toolName: string;
    targetPath: string;
    exists: boolean;
    isSymlink: boolean;
    linkedTo?: string;
    error?: string;
}

/**
 * 确保目录存在，如果不存在则递归创建
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
        await fs.promises.mkdir(dirPath, { recursive: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error;
        }
    }
}

/**
 * 初始化中央仓库目录
 */
export async function initializeCentralWarehouse(): Promise<string> {
    const warehousePath = getCentralWarehousePath();
    await ensureDirectoryExists(warehousePath);
    return warehousePath;
}

/**
 * 检查路径是否为符号链接
 */
export async function isSymlink(targetPath: string): Promise<boolean> {
    try {
        const stats = await fs.promises.lstat(targetPath);
        return stats.isSymbolicLink();
    } catch {
        return false;
    }
}

/**
 * 获取符号链接的目标路径
 */
export async function getSymlinkTarget(linkPath: string): Promise<string | null> {
    try {
        return await fs.promises.readlink(linkPath);
    } catch {
        return null;
    }
}

/**
 * 检查路径是否存在
 */
export async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.promises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * 创建符号链接将工具目录链接到中央仓库
 * @param toolId 工具 ID
 * @param force 是否强制覆盖现有目录
 */
export async function createSymlinkForTool(toolId: string, force: boolean = false): Promise<void> {
    const toolConfig = getToolPathById(toolId);
    if (!toolConfig) {
        throw new Error(`未知的工具 ID: ${toolId}`);
    }

    const centralPath = getCentralWarehousePath();
    const toolPath = toolConfig.getPath();
    const toolParentDir = path.dirname(toolPath);

    // 确保中央仓库存在
    await ensureDirectoryExists(centralPath);

    // 确保工具的父目录存在
    await ensureDirectoryExists(toolParentDir);

    // 检查目标路径状态
    const exists = await pathExists(toolPath);
    const isLink = await isSymlink(toolPath);

    if (exists && !isLink) {
        if (force) {
            // 备份现有目录
            const backupPath = `${toolPath}_backup_${Date.now()}`;
            await fs.promises.rename(toolPath, backupPath);
            vscode.window.showInformationMessage(`已备份原目录到: ${backupPath}`);
        } else {
            throw new Error(`目录已存在且非符号链接: ${toolPath}。使用强制模式覆盖或手动处理。`);
        }
    } else if (isLink) {
        // 已经是符号链接，删除后重新创建
        await fs.promises.unlink(toolPath);
    }

    // 创建符号链接
    // Windows 上需要 'junction' 类型以避免管理员权限问题
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.promises.symlink(centralPath, toolPath, symlinkType);
}

/**
 * 获取所有工具的链接状态
 */
export async function getAllLinkStatus(): Promise<LinkStatus[]> {
    const results: LinkStatus[] = [];
    const centralPath = getCentralWarehousePath();

    for (const tool of TOOL_PATHS) {
        const toolPath = tool.getPath();
        const status: LinkStatus = {
            toolId: tool.id,
            toolName: tool.name,
            targetPath: toolPath,
            exists: false,
            isSymlink: false
        };

        try {
            status.exists = await pathExists(toolPath);
            if (status.exists) {
                status.isSymlink = await isSymlink(toolPath);
                if (status.isSymlink) {
                    status.linkedTo = await getSymlinkTarget(toolPath) || undefined;
                }
            }
        } catch (error) {
            status.error = (error as Error).message;
        }

        results.push(status);
    }

    return results;
}

/**
 * 移除工具的符号链接
 */
export async function removeSymlinkForTool(toolId: string): Promise<void> {
    const toolConfig = getToolPathById(toolId);
    if (!toolConfig) {
        throw new Error(`未知的工具 ID: ${toolId}`);
    }

    const toolPath = toolConfig.getPath();
    const isLink = await isSymlink(toolPath);

    if (!isLink) {
        throw new Error(`路径不是符号链接: ${toolPath}`);
    }

    await fs.promises.unlink(toolPath);
}
