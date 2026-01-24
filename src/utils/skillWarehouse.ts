import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Skill 信息
 */
export interface SkillInfo {
    name: string;
    path: string;           // 文件完整路径
    description: string;
    isEnabled: boolean;     // 是否已激活
    source: 'local' | 'github';
    sourceUrl?: string;
}

/**
 * 获取 Skills 目录路径 (Claude 官方路径)
 * 已激活的 skills 直接放在这个目录下
 */
export function getSkillsPath(): string {
    return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * 获取禁用 Skills 目录路径
 */
export function getDisabledPath(): string {
    return path.join(getSkillsPath(), '.disabled');
}

/**
 * 确保目录存在
 */
export async function ensureDirectoriesExist(): Promise<void> {
    const skillsPath = getSkillsPath();
    const disabledPath = getDisabledPath();

    if (!fs.existsSync(skillsPath)) {
        await fs.promises.mkdir(skillsPath, { recursive: true });
    }
    if (!fs.existsSync(disabledPath)) {
        await fs.promises.mkdir(disabledPath, { recursive: true });
    }
}

/**
 * 从 SKILL.md 提取描述
 */
async function extractDescriptionFromFile(filePath: string): Promise<string> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        // 从 YAML frontmatter 提取 description
        const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (yamlMatch) {
            const descMatch = yamlMatch[1].match(/description:\s*(.+)/);
            if (descMatch) {
                return descMatch[1].trim().replace(/^["']|["']$/g, '');
            }
        }
        // 取第一个非标题、非frontmatter行
        const firstLine = content.split('\n').find(line =>
            line.trim() && !line.startsWith('#') && !line.startsWith('---')
        );
        return firstLine?.trim().substring(0, 200) || '';
    } catch {
        return '';
    }
}

/**
 * 从目录提取描述
 */
async function extractDescriptionFromDir(dirPath: string): Promise<string> {
    const skillMd = path.join(dirPath, 'SKILL.md');
    if (fs.existsSync(skillMd)) {
        return extractDescriptionFromFile(skillMd);
    }
    return '';
}

/**
 * 扫描目录中的 skills
 * 官方标准：只识别包含 SKILL.md 的目录
 */
async function scanDirectory(dirPath: string, isEnabled: boolean): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    if (!fs.existsSync(dirPath)) { return skills; }

    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            // 跳过隐藏目录和非目录
            if (!entry.isDirectory() || entry.name.startsWith('.')) { continue; }

            const fullPath = path.join(dirPath, entry.name);
            const skillMdPath = path.join(fullPath, 'SKILL.md');

            // 官方标准：只识别包含 SKILL.md 的目录
            if (!fs.existsSync(skillMdPath)) { continue; }

            const description = await extractDescriptionFromDir(fullPath);

            // 读取元数据
            let source: 'local' | 'github' = 'local';
            let sourceUrl: string | undefined;
            const metaPath = path.join(fullPath, '.skill-meta.json');
            if (fs.existsSync(metaPath)) {
                try {
                    const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
                    source = meta.source || 'local';
                    sourceUrl = meta.sourceUrl;
                } catch { }
            }

            skills.push({
                name: entry.name,
                path: fullPath,
                description,
                isEnabled,
                source,
                sourceUrl
            });
        }
    } catch (error) {
        console.error(`扫描目录 ${dirPath} 失败:`, error);
    }

    return skills;
}

/**
 * 扫描所有 Skills (已激活 + 禁用)
 */
export async function scanAllSkills(): Promise<SkillInfo[]> {
    await ensureDirectoriesExist();

    const enabledSkills = await scanDirectory(getSkillsPath(), true);
    const disabledSkills = await scanDirectory(getDisabledPath(), false);

    return [...enabledSkills, ...disabledSkills];
}

/**
 * 激活 Skill
 * 从 .disabled 移动到 skills 目录
 */
export async function enableSkill(skillName: string): Promise<boolean> {
    const skillsPath = getSkillsPath();
    const disabledPath = getDisabledPath();

    const srcPath = path.join(disabledPath, skillName);
    const destPath = path.join(skillsPath, skillName);

    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
        throw new Error(`Skill "${skillName}" 不存在于禁用目录中`);
    }

    // 验证是否为有效 skill (包含 SKILL.md)
    if (!fs.existsSync(path.join(srcPath, 'SKILL.md'))) {
        throw new Error(`"${skillName}" 不是有效的 Skill (缺少 SKILL.md)`);
    }

    try {
        await safeMove(srcPath, destPath);
        return true;
    } catch (error: any) {
        console.error(`激活 Skill "${skillName}" 失败:`, error);
        throw new Error(`激活技能失败: ${error.message}`);
    }
}

/**
 * 禁用 Skill
 * 从 skills 目录移动到 .disabled
 */
export async function disableSkill(skillName: string): Promise<boolean> {
    const skillsPath = getSkillsPath();
    const disabledPath = getDisabledPath();

    const srcPath = path.join(skillsPath, skillName);
    const destPath = path.join(disabledPath, skillName);

    if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) {
        throw new Error(`Skill "${skillName}" 不存在于激活目录中`);
    }

    try {
        await safeMove(srcPath, destPath);
        return true;
    } catch (error: any) {
        console.error(`禁用 Skill "${skillName}" 失败:`, error);
        throw new Error(`禁用技能失败: ${error.message}`);
    }
}

/**
 * 递归删除目录（带重试机制）
 */
async function removeDirectory(dirPath: string, retries = 3, delayMs = 100): Promise<void> {
    for (let i = 0; i < retries; i++) {
        try {
            // 递归读取目录
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            // 先删除所有子项
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    await removeDirectory(fullPath, retries, delayMs);
                } else {
                    await fs.promises.unlink(fullPath);
                }
            }

            // 删除空目录
            await fs.promises.rmdir(dirPath);
            return; // 成功则返回
        } catch (error: any) {
            if (i === retries - 1) {
                // 最后一次重试仍然失败
                throw error;
            }
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
        }
    }
}

/**
 * 安全移动目录（使用复制+删除策略，避免Windows文件占用问题）
 */
async function safeMove(srcPath: string, destPath: string): Promise<void> {
    // 如果目标已存在，先删除
    if (fs.existsSync(destPath)) {
        await removeDirectory(destPath);
    }

    try {
        // 1. 先尝试直接重命名（最快）
        await fs.promises.rename(srcPath, destPath);
        return;
    } catch (renameError: any) {
        console.log(`重命名失败，使用复制+删除策略: ${renameError.message}`);

        // 2. 如果重命名失败，使用复制+删除策略
        try {
            // 复制整个目录
            await copyDirectory(srcPath, destPath);

            // 等待一小段时间，确保文件系统释放句柄
            await new Promise(resolve => setTimeout(resolve, 200));

            // 删除源目录
            await removeDirectory(srcPath);
        } catch (error: any) {
            // 如果复制成功但删除失败，至少目标已经创建了
            if (fs.existsSync(destPath)) {
                console.warn(`目标已复制成功，但源目录删除失败: ${error.message}`);
                console.warn(`请手动删除源目录: ${srcPath}`);
                return;
            }
            throw error;
        }
    }
}

/**
 * 递归复制目录
 */
export async function copyDirectory(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

/**
 * 迁移旧结构到新结构
 */
export async function migrateToNewStructure(): Promise<number> {
    // 此函数保留用于兼容性，新结构不需要迁移
    return 0;
}
