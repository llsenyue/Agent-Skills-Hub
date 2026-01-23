import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolDefinition {
    id: string;
    name: string;
    rootPath: string[];   // 工具根目录（用于检测工具是否安装）
    globalPath: string[]; // Skills 全局存放路径
}

export interface ToolStatus {
    tool: ToolDefinition;
    isInstalled: boolean;      // 工具是否安装（检测根目录是否存在）
    isLinked: boolean;         // 是否已链接到中央仓库
    currentPath?: string;      // 实际检测到的 skills 路径
    linkTarget?: string;       // 链接的目标（如果是已链接状态）
    skillsCount: number;       // Skills 数量
}

// 根据官方文档的路径配置
export const SUPPORTED_TOOLS: ToolDefinition[] = [
    {
        id: 'claude',
        name: 'Claude Code',
        rootPath: ['.claude'],
        globalPath: ['.claude/skills']
    },
    {
        id: 'gemini',
        name: 'Gemini CLI',
        rootPath: ['.gemini'],
        globalPath: ['.gemini/skills']
    },
    {
        id: 'antigravity',
        name: 'Antigravity',
        rootPath: ['.gemini/antigravity'],
        globalPath: ['.gemini/antigravity/global_skills']  // 官方路径
    },
    {
        id: 'windsurf',
        name: 'Windsurf',
        rootPath: ['.codeium/windsurf'],
        globalPath: ['.codeium/windsurf/skills']
    },
    {
        id: 'opencode',
        name: 'OpenCode',
        rootPath: ['.config/opencode', '.opencode'],
        globalPath: ['.config/opencode/skill', '.opencode/skill']  // 注意是 skill 不是 skills
    },
    {
        id: 'codex',
        name: 'Codex CLI',
        rootPath: ['.codex'],
        globalPath: ['.codex/skills']
    }
];

/**
 * 获取用户主目录下的绝对路径
 */
function resolveHomePath(relativePath: string): string {
    return path.join(os.homedir(), relativePath);
}

/**
 * 检测工具状态
 */
export async function detectTools(): Promise<ToolStatus[]> {
    const statuses: ToolStatus[] = [];

    // 获取用户配置覆盖
    const config = vscode.workspace.getConfiguration('skillManager');
    const customPaths = config.get<{ [key: string]: string }>('toolPaths') || {};

    for (const tool of SUPPORTED_TOOLS) {
        let detectedSkillsPath: string | undefined;
        let isInstalled = false;
        let isLinked = false;
        let linkTarget: string | undefined;

        // 1. 检测工具是否安装（检查根目录是否存在）
        let detectedRootPath: string | undefined;
        for (const rp of tool.rootPath) {
            const absRootPath = resolveHomePath(rp);
            if (fs.existsSync(absRootPath)) {
                detectedRootPath = absRootPath;
                isInstalled = true;
                break;
            }
        }

        // 2. 如果工具已安装，检查/创建 skills 文件夹
        if (isInstalled && detectedRootPath) {
            // 检查是否有自定义 skills 路径
            if (customPaths[tool.id]) {
                detectedSkillsPath = customPaths[tool.id].replace(/^~/, os.homedir());
            } else {
                // 遍历候选 skills 路径
                for (const sp of tool.globalPath) {
                    const absSkillsPath = resolveHomePath(sp);
                    try {
                        const stats = fs.lstatSync(absSkillsPath);
                        if (stats.isDirectory() || stats.isSymbolicLink()) {
                            detectedSkillsPath = absSkillsPath;
                            break;
                        }
                    } catch {
                        // 路径不存在，继续检查下一个
                    }
                }

                // 如果 skills 文件夹不存在，自动创建一个空的
                if (!detectedSkillsPath) {
                    const defaultSkillsPath = resolveHomePath(tool.globalPath[0]);
                    try {
                        await fs.promises.mkdir(defaultSkillsPath, { recursive: true });
                        detectedSkillsPath = defaultSkillsPath;
                        console.log(`[detectTools] ${tool.name}: Created missing skills folder at ${defaultSkillsPath}`);
                    } catch (e) {
                        console.error(`[detectTools] Failed to create skills folder for ${tool.name}:`, e);
                    }
                }
            }

            // 3. 检查是否已链接到中央仓库（所有工具统一处理）
            if (detectedSkillsPath) {
                try {
                    const stats = await fs.promises.lstat(detectedSkillsPath);
                    if (stats.isSymbolicLink()) {
                        isLinked = true;
                        linkTarget = await fs.promises.readlink(detectedSkillsPath);
                    }
                } catch (e) {
                    console.error(`[detectTools] Error checking symlink for ${tool.name}:`, e);
                }
            }
        }

        // 确定显示路径（即使未安装也需要显示预期路径）
        const displayPath = detectedSkillsPath || resolveHomePath(tool.globalPath[0]);

        // 计算 Skills 数量
        let skillsCount = 0;
        if (detectedSkillsPath) {
            try {
                const entries = await fs.promises.readdir(detectedSkillsPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && entry.name.endsWith('.md')) {
                        skillsCount++;
                    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        skillsCount++;
                    }
                }
            } catch {
                // 目录读取失败，保持 0
            }
        }

        statuses.push({
            tool,
            isInstalled,
            isLinked,
            currentPath: displayPath,
            linkTarget,
            skillsCount
        });
    }

    return statuses;
}

/**
 * 创建工具链接
 */
export async function linkTool(toolId: string, warehousePath: string): Promise<boolean> {
    const tool = SUPPORTED_TOOLS.find(t => t.id === toolId);
    if (!tool) {
        throw new Error(`Tool ${toolId} not found`);
    }

    // 获取目标路径（优先配置，否则默认）
    const config = vscode.workspace.getConfiguration('skillManager');
    const customPaths = config.get<{ [key: string]: string }>('toolPaths') || {};

    let targetPath = '';
    if (customPaths[toolId]) {
        targetPath = customPaths[toolId].replace(/^~/, os.homedir());
    } else {
        targetPath = resolveHomePath(tool.globalPath[0]);
    }

    try {
        // 确保中央仓库目录存在（使用 lstat 避免 ELOOP 错误）
        let warehouseExists = false;
        try {
            const stats = fs.lstatSync(warehousePath);
            warehouseExists = stats.isDirectory() || stats.isSymbolicLink();
        } catch {
            warehouseExists = false;
        }

        if (!warehouseExists) {
            await fs.promises.mkdir(warehousePath, { recursive: true });
        }

        // 确保父目录存在
        const parentDir = path.dirname(targetPath);
        if (!fs.existsSync(parentDir)) {
            await fs.promises.mkdir(parentDir, { recursive: true });
        }

        // 如果目标路径存在且是普通目录，先将内容复制到中央仓库
        if (fs.existsSync(targetPath)) {
            const stats = await fs.promises.lstat(targetPath);
            if (stats.isSymbolicLink()) {
                // 如果已经是软链，先删除
                // Windows 下 Junction 很难删除，使用系统命令最可靠
                if (os.platform() === 'win32') {
                    try {
                        await execAsync(`rmdir "${targetPath}"`);
                    } catch (e) {
                        try {
                            await execAsync(`rmdir /s /q "${targetPath}"`);
                        } catch (e2) {
                            await fs.promises.rm(targetPath, { recursive: true, force: true });
                        }
                    }
                } else {
                    await fs.promises.unlink(targetPath).catch(() =>
                        fs.promises.rm(targetPath, { recursive: true, force: true })
                    );
                }
            } else if (stats.isDirectory()) {
                // 如果是普通目录，将内容复制到中央仓库
                await copyDirectoryContents(targetPath, warehousePath);
                // 然后删除原目录
                await fs.promises.rm(targetPath, { recursive: true, force: true });
            }
        }

        // 创建软链接
        // Windows 上使用 junction（不需要管理员权限）
        const type = os.platform() === 'win32' ? 'junction' : 'dir';
        await fs.promises.symlink(warehousePath, targetPath, type);

        return true;
    } catch (e) {
        console.error(`Failed to link ${tool.name}:`, e);
        throw e;
    }
}

/**
 * 复制目录内容到目标目录（不覆盖已存在的文件）
 */
async function copyDirectoryContents(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        // 如果目标已存在，跳过（避免覆盖中央仓库的内容）
        if (fs.existsSync(destPath)) {
            continue;
        }

        if (entry.isDirectory()) {
            // 递归复制目录
            await fs.promises.mkdir(destPath, { recursive: true });
            await copyDirectoryContents(srcPath, destPath);
        } else if (entry.isFile()) {
            // 复制文件
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

/**
 * 取消工具链接
 * @param syncBack 是否将中央仓库的 skills 同步回工具目录
 */
export async function unlinkTool(toolId: string, warehousePath: string, syncBack: boolean = false): Promise<boolean> {
    const tool = SUPPORTED_TOOLS.find(t => t.id === toolId);
    if (!tool) {
        throw new Error(`Tool ${toolId} not found`);
    }

    const config = vscode.workspace.getConfiguration('skillManager');
    const customPaths = config.get<{ [key: string]: string }>('toolPaths') || {};

    // 智能探测目标路径（与 detectTools 逻辑保持一致）
    let targetPath: string | undefined;

    if (customPaths[toolId]) {
        const p = customPaths[toolId].replace(/^~/, os.homedir());
        targetPath = p;
        // 即使自定义路径不存在，我们也假设用户想对它操作，但后面会检查
    } else {
        // 遍历所有可能的 globalPath
        for (const p of tool.globalPath) {
            const abs = resolveHomePath(p);
            try {
                // 使用 lstat 而不是 existsSync，以发现坏掉的软链
                await fs.promises.lstat(abs);
                targetPath = abs;
                break;
            } catch {
                // continue
            }
        }
        // 如果都找不到，默认取第一个
        if (!targetPath) {
            targetPath = resolveHomePath(tool.globalPath[0]);
        }
    }

    // 显示诊断信息，帮助确认我们在操作正确的路径
    vscode.window.showInformationMessage(`正在断开路径: ${targetPath}`);

    try {
        // 检查路径是否存在 (使用 lstat)
        let stats: fs.Stats | undefined;
        try {
            stats = await fs.promises.lstat(targetPath);
        } catch {
            // 路径真的不存在
            return false;
        }

        if (stats && stats.isSymbolicLink()) {
            // Windows Junction 只是一个指针，用不带参数的 rmdir 即可移除
            // 重要：不要用 /s /q，那是用来删除有内容的文件夹的
            if (os.platform() === 'win32') {
                // 简单的 rmdir 就足够了
                await execAsync(`rmdir "${targetPath}"`);
            } else {
                // Unix/Mac 上的符号链接
                await fs.promises.unlink(targetPath);
            }

            // 给文件系统一点时间
            await new Promise(resolve => setTimeout(resolve, 200));

            // 关键校验：确认链接是否真的被删除了
            let stillExists = false;
            try {
                const checkStats = await fs.promises.lstat(targetPath);
                if (checkStats.isSymbolicLink()) {
                    stillExists = true;
                }
            } catch {
                // lstat 抛错说明文件不存在了，这才是成功！
                stillExists = false;
            }

            if (stillExists) {
                throw new Error(`文件占用：无法删除符号链接 ${targetPath}。请关闭占用该目录的程序（如终端或资源管理器）重试。`);
            }

            // 断开链接后，始终创建一个新的普通目录（确保工具仍显示为"已安装"）
            // 对于 Antigravity 等路径相同的工具，跳过（它本身就是中央仓库）
            if (path.normalize(targetPath) !== path.normalize(warehousePath)) {
                if (!fs.existsSync(targetPath)) {
                    // 创建新目录
                    await fs.promises.mkdir(targetPath, { recursive: true });

                    // 如果用户选择同步，则复制内容
                    if (syncBack && fs.existsSync(warehousePath)) {
                        await copyDirectoryContents(warehousePath, targetPath);
                    }
                }
            }
            return true;
        }

        return false;
    } catch (e) {
        console.error(`Failed to unlink ${tool.name}:`, e);
        throw e;
    }
}
