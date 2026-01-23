import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getSkillsPath, getDisabledPath, ensureDirectoriesExist, copyDirectory } from './skillWarehouse';

const execAsync = promisify(exec);

/**
 * 使用稀疏检出克隆仓库的特定目录
 * 这比完整克隆快得多，特别是对于大型仓库
 * 
 * @param repoUrl 仓库 URL
 * @param branch 分支名
 * @param sparseDir 要检出的目录路径
 * @param targetDir 目标目录
 */
async function sparseClone(repoUrl: string, branch: string, sparseDir: string, targetDir: string): Promise<void> {
    // 创建目标目录
    await fs.promises.mkdir(targetDir, { recursive: true });

    try {
        // 使用 Git 2.25+ 的 sparse-checkout 功能
        // 初始化仓库并配置 sparse-checkout
        await execAsync(`git init`, { cwd: targetDir });
        await execAsync(`git remote add origin "${repoUrl}.git"`, { cwd: targetDir });

        // 初始化 sparse-checkout（cone 模式，性能更好）
        await execAsync(`git sparse-checkout init --cone`, { cwd: targetDir });

        // 设置要检出的目录（使用 set 命令确保下载文件内容）
        await execAsync(`git sparse-checkout set "${sparseDir}"`, { cwd: targetDir });

        // 拉取指定分支（仅获取最近一个 commit）
        await execAsync(`git fetch --depth 1 origin "${branch}"`, { cwd: targetDir });
        await execAsync(`git checkout "${branch}"`, { cwd: targetDir });

        console.log(`Sparse checkout completed for ${sparseDir}`);

        // 检测并处理符号链接
        await handleSymlinksInSparseCheckout(targetDir, sparseDir, branch);
    } catch (error) {
        // 如果稀疏检出失败（可能是 Git 版本过低），回退到完整克隆
        console.warn('Sparse checkout failed, falling back to full clone:', error);
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        await execAsync(`git clone --depth 1 --branch "${branch}" "${repoUrl}.git" "${targetDir}"`);
    }
}

/**
 * 处理稀疏检出中的符号链接
 * 如果目录中包含符号链接指向其他仓库路径，则额外下载这些目标路径
 * 也支持 sparseDir 本身就是一个符号链接文件的情况
 */
async function handleSymlinksInSparseCheckout(targetDir: string, sparseDir: string, branch: string): Promise<void> {
    const checkPath = path.join(targetDir, sparseDir);
    const additionalPaths: string[] = [];

    if (!fs.existsSync(checkPath)) {
        return;
    }

    try {
        const stat = await fs.promises.stat(checkPath);

        if (stat.isFile() && stat.size < 200) {
            // sparseDir 本身可能是一个符号链接文件
            const content = await fs.promises.readFile(checkPath, 'utf-8');
            if (content.match(/^\.\.?\//)) {
                const linkTarget = content.trim();
                // 从符号链接文件的父目录开始解析相对路径
                const parentDir = path.posix.dirname(sparseDir);
                const resolvedPath = path.posix.normalize(
                    path.posix.join(parentDir, linkTarget)
                );
                console.log(`Detected symlink file: ${sparseDir} -> ${linkTarget} (resolved: ${resolvedPath})`);
                additionalPaths.push(resolvedPath);
            }
        } else if (stat.isDirectory()) {
            // sparseDir 是一个目录，检查其中的符号链接文件
            const entries = await fs.promises.readdir(checkPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.isFile()) {
                    const entryPath = path.join(checkPath, entry.name);
                    try {
                        const entryStat = await fs.promises.stat(entryPath);
                        if (entryStat.size < 200) {
                            const content = await fs.promises.readFile(entryPath, 'utf-8');
                            if (content.match(/^\.\.?\//)) {
                                const linkTarget = content.trim();
                                const resolvedPath = path.posix.normalize(
                                    path.posix.join(sparseDir, linkTarget)
                                );
                                console.log(`Detected symlink: ${entry.name} -> ${linkTarget} (resolved: ${resolvedPath})`);
                                additionalPaths.push(resolvedPath);
                            }
                        }
                    } catch {
                        // 忽略读取错误
                    }
                }
            }
        }

        // 如果发现符号链接目标，额外下载这些目录
        if (additionalPaths.length > 0) {
            console.log(`Found ${additionalPaths.length} symlink targets, adding to sparse-checkout...`);
            for (const addPath of additionalPaths) {
                try {
                    await execAsync(`git sparse-checkout add "${addPath}"`, { cwd: targetDir });
                } catch (e) {
                    console.warn(`Failed to add symlink target ${addPath}:`, e);
                }
            }
            // 重新 checkout 以获取新添加的目录
            await execAsync(`git checkout "${branch}"`, { cwd: targetDir });
        }
    } catch (error) {
        console.warn('Error handling symlinks:', error);
    }
}


/**
 * Skills 来源定义
 */
export interface SkillSource {
    id: string;
    name: string;           // 显示名称
    repoUrl: string;        // GitHub 仓库 URL
    branch: string;         // 分支 (默认 main)
    skillsPath: string;     // 仓库内 skills 目录路径
    enabled: boolean;       // 是否启用
    autoUpdate: boolean;    // 是否自动更新
    lastUpdated?: number;   // 上次更新时间戳
    lastCommitHash?: string; // 上次同步的 commit hash
    skillCount?: number;    // 导入的 skill 数量
    status?: 'synced' | 'pending' | 'error' | 'updating'; // 同步状态
    // 更新检测相关
    hasUpdate?: boolean;    // 是否有可用更新
    lastChecked?: number;   // 上次检查时间
}

/**
 * Skill 元数据 (存储在每个 skill 目录的 .skill-meta.json)
 */
export interface SkillMetadata {
    source: 'marketplace' | 'github' | 'local';
    sourceUrl?: string;
    installDate: number;
    commitHash?: string;
    version?: string;
    author?: string;
    description?: string;
}

/**
 * 来源配置文件路径
 */
function getSourcesConfigPath(): string {
    return path.join(getSkillsPath(), '.sources.json');
}

/**
 * 获取来源存储目录 (git clone 的缓存目录)
 */
function getSourcesDir(): string {
    return path.join(getSkillsPath(), '.sources');
}

/**
 * 读取所有来源配置
 */
export async function getSkillSources(): Promise<SkillSource[]> {
    const configPath = getSourcesConfigPath();
    try {
        if (fs.existsSync(configPath)) {
            const content = await fs.promises.readFile(configPath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (e) {
        console.error('读取来源配置失败:', e);
    }
    return [];
}

/**
 * 保存来源配置
 */
async function saveSkillSources(sources: SkillSource[]): Promise<void> {
    const configPath = getSourcesConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(configPath, JSON.stringify(sources, null, 2), 'utf-8');
}

/**
 * 从 GitHub URL 解析仓库信息
 * 支持格式:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/tree/branch/subpath
 */
function parseGitHubUrl(url: string): { owner: string; repo: string; branch?: string; subpath?: string } | null {
    // 移除尾部斜杠
    url = url.trim().replace(/\/+$/, '');

    // 格式1: https://github.com/owner/repo/tree/branch/subpath
    const treeMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)(?:\/(.+))?/);
    if (treeMatch) {
        return {
            owner: treeMatch[1],
            repo: treeMatch[2].replace('.git', ''),
            branch: treeMatch[3],
            subpath: treeMatch[4]
        };
    }

    // 格式2: https://github.com/owner/repo
    const simpleMatch = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (simpleMatch) {
        return {
            owner: simpleMatch[1],
            repo: simpleMatch[2].replace('.git', '')
        };
    }

    // 格式3: owner/repo
    const shortMatch = url.match(/^([^\/]+)\/([^\/]+)$/);
    if (shortMatch) {
        return { owner: shortMatch[1], repo: shortMatch[2] };
    }

    return null;
}

/**
 * 添加新的 GitHub 来源
 */
export async function addSkillSource(url: string, options: Partial<SkillSource> = {}): Promise<SkillSource> {
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
        throw new Error(`无效的 GitHub URL: ${url}`);
    }

    const sources = await getSkillSources();
    const id = `${parsed.owner}-${parsed.repo}`;

    // 检查是否已存在
    if (sources.find(s => s.id === id)) {
        throw new Error(`来源 ${id} 已存在`);
    }

    const newSource: SkillSource = {
        id,
        name: options.name || `${parsed.owner}/${parsed.repo}`,
        repoUrl: `https://github.com/${parsed.owner}/${parsed.repo}`,
        branch: parsed.branch || options.branch || 'main',
        skillsPath: parsed.subpath || options.skillsPath || '.',
        enabled: options.enabled !== false,
        autoUpdate: options.autoUpdate || false,
        lastUpdated: undefined,
        status: 'pending'
    };

    sources.push(newSource);
    await saveSkillSources(sources);

    // 立即同步，如果失败则回滚
    try {
        await syncSource(newSource);
        // 重新读取更新后的源信息
        const updatedSources = await getSkillSources();
        const updatedSource = updatedSources.find(s => s.id === id);
        return updatedSource || newSource;
    } catch (syncError) {
        // 同步失败，回滚：删除刚添加的来源
        console.error(`同步失败，回滚来源 ${id}:`, syncError);
        try {
            await removeSkillSource(id);
        } catch (rollbackError) {
            console.error('回滚失败:', rollbackError);
        }
        // 重新抛出原始错误
        throw syncError;
    }
}

/**
 * 删除来源
 */
export async function removeSkillSource(id: string): Promise<void> {
    const sources = await getSkillSources();
    const index = sources.findIndex(s => s.id === id);

    if (index === -1) {
        throw new Error(`来源 ${id} 不存在`);
    }

    // 删除本地克隆的目录
    const sourceDir = path.join(getSourcesDir(), id);
    if (fs.existsSync(sourceDir)) {
        await fs.promises.rm(sourceDir, { recursive: true, force: true });
    }

    sources.splice(index, 1);
    await saveSkillSources(sources);
}

/**
 * 更新来源配置
 */
export async function updateSkillSource(id: string, updates: Partial<SkillSource>): Promise<void> {
    const sources = await getSkillSources();
    const source = sources.find(s => s.id === id);

    if (!source) {
        throw new Error(`来源 ${id} 不存在`);
    }

    Object.assign(source, updates);
    await saveSkillSources(sources);
}

/**
 * 同步单个来源（克隆或拉取更新）
 * 
 * 技能识别规则 (基于 Claude 官方标准):
 * 1. 包含 SKILL.md 的目录 = 一个 Skill
 * 2. 如果仓库根目录有 SKILL.md，整个仓库就是一个 Skill
 * 3. 如果仓库有 skills/ 或 .claude/skills/ 目录，扫描其中的子目录
 */
export async function syncSource(source: SkillSource): Promise<{ added: number; updated: number }> {
    const sourcesDir = getSourcesDir();
    const sourceDir = path.join(sourcesDir, source.id);
    const disabledPath = getDisabledPath();

    await ensureDirectoriesExist();

    // 确保来源目录存在
    if (!fs.existsSync(sourcesDir)) {
        await fs.promises.mkdir(sourcesDir, { recursive: true });
    }

    // 判断是否可以使用稀疏检出（当指定了具体的 skillsPath 时）
    const useSparseCheckout = source.skillsPath && source.skillsPath !== '.';

    // 克隆或拉取仓库
    if (!fs.existsSync(sourceDir)) {
        if (useSparseCheckout) {
            // 使用稀疏检出：只下载需要的目录，大幅加快速度
            await sparseClone(source.repoUrl, source.branch, source.skillsPath, sourceDir);
        } else {
            // 普通克隆整个仓库
            const cloneUrl = `${source.repoUrl}.git`;
            await execAsync(`git clone --depth 1 --branch "${source.branch}" "${cloneUrl}" "${sourceDir}"`);
        }
    } else {
        // 拉取更新
        try {
            await execAsync(`git -C "${sourceDir}" pull origin "${source.branch}"`);
        } catch {
            // 如果拉取失败，删除并重新克隆
            await fs.promises.rm(sourceDir, { recursive: true, force: true });
            if (useSparseCheckout) {
                await sparseClone(source.repoUrl, source.branch, source.skillsPath, sourceDir);
            } else {
                const cloneUrl = `${source.repoUrl}.git`;
                await execAsync(`git clone --depth 1 --branch "${source.branch}" "${cloneUrl}" "${sourceDir}"`);
            }
        }
    }

    // 查找并导入 Skills
    let added = 0;
    let updated = 0;

    // 确定要扫描的根目录
    let scanRoot = sourceDir;
    if (source.skillsPath && source.skillsPath !== '.') {
        scanRoot = path.join(sourceDir, source.skillsPath);
    }

    if (!fs.existsSync(scanRoot)) {
        // 尝试常见的 skills 目录
        const possiblePaths = [
            path.join(sourceDir, 'skills'),
            path.join(sourceDir, '.claude', 'skills'),
            path.join(sourceDir, '.agent', 'skills'),
        ];
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                scanRoot = p;
                break;
            }
        }
    }

    // 如果 scanRoot 是符号链接文件而不是目录，则解析到实际目录
    if (fs.existsSync(scanRoot)) {
        const scanRootStat = await fs.promises.stat(scanRoot);
        if (scanRootStat.isFile() && scanRootStat.size < 200) {
            // 可能是符号链接占位符文件
            const content = await fs.promises.readFile(scanRoot, 'utf-8');
            if (content.match(/^\.\.?\//)) {
                // 这是符号链接，解析到实际目录
                const linkTarget = content.trim();
                const parentDir = path.dirname(scanRoot);
                const resolvedPath = path.normalize(path.join(parentDir, linkTarget));
                console.log(`Resolved symlink scanRoot: ${scanRoot} -> ${resolvedPath}`);
                if (fs.existsSync(resolvedPath)) {
                    scanRoot = resolvedPath;
                }
            }
        }
    }

    // 检查仓库根是否就是一个 Skill（包含 SKILL.md）
    if (fs.existsSync(path.join(sourceDir, 'SKILL.md'))) {
        // 整个仓库就是一个 Skill
        const skillName = source.id;
        // 检查是否已存在于已激活目录
        const enabledPath = path.join(getSkillsPath(), skillName);
        const disPath = path.join(disabledPath, skillName);
        let targetPath: string;
        let existed: boolean;

        if (fs.existsSync(enabledPath) && fs.existsSync(path.join(enabledPath, 'SKILL.md'))) {
            targetPath = enabledPath;
            existed = true;
        } else if (fs.existsSync(disPath)) {
            targetPath = disPath;
            existed = true;
        } else {
            targetPath = disPath;
            existed = false;
        }

        await copySkillDirectory(sourceDir, targetPath, source);
        if (existed) { updated++; } else { added++; }
    } else if (fs.existsSync(scanRoot)) {
        // 先检查 scanRoot 本身是否就是一个 Skill 目录
        // 这处理了 skillsPath 直接指向技能目录的情况（如 .claude/skills/create-pr）
        if (fs.existsSync(path.join(scanRoot, 'SKILL.md'))) {
            // scanRoot 本身就是一个 Skill
            const skillName = path.basename(scanRoot);
            // 检查是否已存在于已激活目录
            const enabledPath = path.join(getSkillsPath(), skillName);
            const disPath = path.join(disabledPath, skillName);
            let targetPath: string;
            let existed: boolean;

            if (fs.existsSync(enabledPath) && fs.existsSync(path.join(enabledPath, 'SKILL.md'))) {
                targetPath = enabledPath;
                existed = true;
            } else if (fs.existsSync(disPath)) {
                targetPath = disPath;
                existed = true;
            } else {
                targetPath = disPath;
                existed = false;
            }

            await copySkillDirectory(scanRoot, targetPath, source);
            if (existed) { updated++; } else { added++; }
        } else {
            // 扫描目录中的子 Skills
            const result = await scanAndImportSkills(scanRoot, disabledPath, source);
            added += result.added;
            updated += result.updated;
        }
    }

    // 获取 commit hash
    const commitHash = await getGitCommitHash(sourceDir);

    // 更新来源状态
    await updateSkillSource(source.id, {
        lastUpdated: Date.now(),
        lastCommitHash: commitHash || undefined,
        skillCount: added + updated,
        status: 'synced'
    });

    return { added, updated };
}

/**
 * 扫描目录并导入包含 SKILL.md 的子目录 (递归扫描)
 * 修复：检查技能是否已存在于已激活目录，避免重复
 */
async function scanAndImportSkills(
    scanDir: string,
    destDir: string,
    source: SkillSource
): Promise<{ added: number; updated: number }> {
    let added = 0;
    let updated = 0;

    // 获取已激活技能目录（主 skills 目录）
    const enabledDir = getSkillsPath();

    // 递归查找所有包含 SKILL.md 的目录
    const skillDirs = await findAllSkillDirectories(scanDir);

    for (const skillDir of skillDirs) {
        const skillName = path.basename(skillDir);

        // 检查技能是否已存在于已激活目录
        const enabledPath = path.join(enabledDir, skillName);
        const disabledPath = path.join(destDir, skillName);

        let targetPath: string;
        let existed: boolean;

        if (fs.existsSync(enabledPath) && fs.existsSync(path.join(enabledPath, 'SKILL.md'))) {
            // 已在激活目录中，更新到激活目录
            targetPath = enabledPath;
            existed = true;
        } else if (fs.existsSync(disabledPath)) {
            // 在禁用目录中，更新到禁用目录
            targetPath = disabledPath;
            existed = true;
        } else {
            // 新技能，添加到禁用目录
            targetPath = disabledPath;
            existed = false;
        }

        await copySkillDirectory(skillDir, targetPath, source);
        if (existed) { updated++; } else { added++; }
    }

    return { added, updated };
}

/**
 * 递归查找所有包含 SKILL.md 的目录
 */
async function findAllSkillDirectories(dir: string, maxDepth: number = 5): Promise<string[]> {
    const results: string[] = [];

    async function scan(currentDir: string, depth: number) {
        if (depth > maxDepth) { return; }

        try {
            const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }

                const subDir = path.join(currentDir, entry.name);
                const skillMdPath = path.join(subDir, 'SKILL.md');

                if (fs.existsSync(skillMdPath)) {
                    // 找到一个 Skill 目录
                    results.push(subDir);
                } else {
                    // 继续递归搜索
                    await scan(subDir, depth + 1);
                }
            }
        } catch {
            // 忽略无法读取的目录
        }
    }

    await scan(dir, 0);
    return results;
}

/**
 * 复制 Skill 目录并保存元数据
 */
async function copySkillDirectory(
    srcDir: string,
    destDir: string,
    source: SkillSource
): Promise<void> {
    // 复制目录
    await copyDirectory(srcDir, destDir);

    // 保存元数据
    const metaPath = path.join(destDir, '.skill-meta.json');
    const metadata = {
        source: 'github',
        sourceUrl: source.repoUrl,
        installDate: Date.now(),
        commitHash: await getGitCommitHash(srcDir)
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * 获取 Git commit hash
 */
async function getGitCommitHash(dir: string): Promise<string | null> {
    try {
        const { stdout } = await execAsync(`git -C "${dir}" rev-parse HEAD`);
        return stdout.trim();
    } catch {
        return null;
    }
}

/**
 * 同步所有启用的来源
 */
export async function syncAllSources(): Promise<{ total: number; success: number; failed: number }> {
    const sources = await getSkillSources();
    const enabledSources = sources.filter(s => s.enabled);

    let success = 0;
    let failed = 0;

    for (const source of enabledSources) {
        try {
            await syncSource(source);
            success++;
        } catch (e) {
            console.error(`同步来源 ${source.name} 失败:`, e);
            failed++;
        }
    }

    return { total: enabledSources.length, success, failed };
}

/**
 * 检查来源是否有更新
 */
export async function checkForUpdates(source: SkillSource): Promise<{ hasUpdate: boolean; remoteHash?: string }> {
    const sourcesDir = getSourcesDir();
    const sourceDir = path.join(sourcesDir, source.id);

    if (!fs.existsSync(sourceDir)) {
        return { hasUpdate: true }; // 未克隆，需要同步
    }

    try {
        // 获取远程最新 commit hash
        const { stdout: remoteHash } = await execAsync(
            `git -C "${sourceDir}" ls-remote origin ${source.branch} | cut -f1`
        );
        const remote = remoteHash.trim().split(/\s/)[0];

        // 获取本地 commit hash
        const { stdout: localHash } = await execAsync(
            `git -C "${sourceDir}" rev-parse HEAD`
        );
        const local = localHash.trim();

        return {
            hasUpdate: remote !== local,
            remoteHash: remote
        };
    } catch {
        return { hasUpdate: false };
    }
}

/**
 * 检查所有来源的更新并保存状态
 * @returns 包含每个来源更新状态的详细信息
 */
export async function checkAllSourcesForUpdates(): Promise<{
    sources: SkillSource[];
    updatesAvailable: number;
}> {
    const sources = await getSkillSources();
    let updatesAvailable = 0;
    const now = Date.now();

    for (const source of sources) {
        if (source.enabled) {
            const { hasUpdate } = await checkForUpdates(source);
            source.hasUpdate = hasUpdate;
            source.lastChecked = now;
            if (hasUpdate) {
                updatesAvailable++;
            }
        }
    }

    // 保存更新后的状态
    await saveSkillSources(sources);

    return { sources, updatesAvailable };
}

/**
 * 获取来源同步状态摘要 (使用已缓存的更新状态)
 */
export async function getSourcesStatus(): Promise<{
    sources: SkillSource[];
    totalSkills: number;
    updatesAvailable: number;
}> {
    const sources = await getSkillSources();
    let totalSkills = 0;
    let updatesAvailable = 0;

    for (const source of sources) {
        if (source.skillCount) {
            totalSkills += source.skillCount;
        }
        // 使用已缓存的 hasUpdate 状态
        if (source.enabled && source.hasUpdate) {
            updatesAvailable++;
        }
    }

    return { sources, totalSkills, updatesAvailable };
}
