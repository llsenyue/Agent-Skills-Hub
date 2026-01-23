/**
 * Skills Marketplace - 技能市场数据管理模块
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getSkillsPath, getDisabledPath, copyDirectory } from './skillWarehouse';

// 市场技能接口
export interface MarketplaceSkill {
    id: string;
    name: string;
    author: string;
    authorAvatar?: string;
    description: string;
    descriptionZh?: string;
    descriptionEn?: string;
    githubUrl: string;
    stars: number;
    forks: number;
    updatedAt?: number;
    path?: string;
    branch?: string;
    tags?: string[];
    hasMarketplace?: boolean;
}

// 本地缓存数据结构
interface MarketplaceCache {
    skills: MarketplaceSkill[];
    lastFetchTime: number;
    totalCount: number;
}

// 市场数据缓存
let marketplaceCache: MarketplaceSkill[] = [];
let lastFetchTime: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30分钟缓存

// 远程数据源 URL - 使用 buzhangsan/skill-manager 仓库 (31,767 skills)
const MARKETPLACE_DATA_URL = 'https://raw.githubusercontent.com/buzhangsan/skill-manager/main/data/all_skills_with_cn.json';

/**
 * 获取本地缓存文件路径
 */
function getLocalCachePath(): string {
    return path.join(os.homedir(), '.agent', 'skills', '.marketplace-cache.json');
}

/**
 * 从本地文件加载缓存
 */
async function loadLocalCache(): Promise<MarketplaceCache | null> {
    try {
        const cachePath = getLocalCachePath();
        if (fs.existsSync(cachePath)) {
            const content = await fs.promises.readFile(cachePath, 'utf-8');
            const cache = JSON.parse(content) as MarketplaceCache;
            console.log(`[Marketplace] 加载本地缓存: ${cache.skills.length} 个技能`);
            return cache;
        }
    } catch (error) {
        console.warn('[Marketplace] 加载本地缓存失败:', error);
    }
    return null;
}

/**
 * 保存缓存到本地文件
 */
async function saveLocalCache(skills: MarketplaceSkill[]): Promise<void> {
    try {
        const cachePath = getLocalCachePath();
        const cacheDir = path.dirname(cachePath);

        // 确保目录存在
        if (!fs.existsSync(cacheDir)) {
            await fs.promises.mkdir(cacheDir, { recursive: true });
        }

        const cache: MarketplaceCache = {
            skills,
            lastFetchTime: Date.now(),
            totalCount: skills.length
        };

        await fs.promises.writeFile(cachePath, JSON.stringify(cache), 'utf-8');
        console.log(`[Marketplace] 保存本地缓存: ${skills.length} 个技能`);
    } catch (error) {
        console.warn('[Marketplace] 保存本地缓存失败:', error);
    }
}

/**
 * 加载市场技能数据
 * @param forceRefresh 是否强制刷新缓存
 */
export async function loadMarketplaceSkills(forceRefresh: boolean = false): Promise<MarketplaceSkill[]> {
    const now = Date.now();

    // 检查内存缓存是否有效
    if (!forceRefresh && marketplaceCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
        return marketplaceCache;
    }

    // 如果内存缓存为空，先尝试加载本地文件缓存
    if (marketplaceCache.length === 0) {
        const localCache = await loadLocalCache();
        if (localCache && localCache.skills.length > 0) {
            marketplaceCache = localCache.skills;
            lastFetchTime = localCache.lastFetchTime;

            // 如果本地缓存仍在有效期内且不强制刷新，直接返回
            if (!forceRefresh && (now - localCache.lastFetchTime) < CACHE_DURATION) {
                return marketplaceCache;
            }
        }
    }

    // 如果有缓存数据（本地或内存）但需要刷新，先返回缓存然后后台刷新
    const hasCache = marketplaceCache.length > 0;

    try {
        const response = await fetch(MARKETPLACE_DATA_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        // 解析数据 - buzhangsan 的数据格式
        if (Array.isArray(data)) {
            marketplaceCache = data.map((item: any) => ({
                id: item.id || item.name || '',
                name: item.name || '',
                author: item.author || 'Unknown',
                authorAvatar: item.authorAvatar,
                description: item.description || '',
                descriptionZh: item.descriptionZh || item.description_zh,
                descriptionEn: item.descriptionEn || item.description_en,
                githubUrl: item.githubUrl || item.github_url || '',
                stars: item.stars || 0,
                forks: item.forks || 0,
                updatedAt: item.updatedAt || item.updated_at,
                path: item.path,
                branch: item.branch || 'main',
                tags: item.tags || [],
                hasMarketplace: item.hasMarketplace
            }));
        } else {
            marketplaceCache = [];
        }

        lastFetchTime = now;

        // 保存到本地文件缓存
        await saveLocalCache(marketplaceCache);

        return marketplaceCache;
    } catch (error) {
        console.error('Failed to load marketplace skills:', error);
        // 返回缓存数据（如果有的话）
        return marketplaceCache;
    }
}

/**
 * 搜索市场技能
 * 支持空格分隔的多条件搜索（AND逻辑）
 * 按优先级排序：技能名称匹配 > 来源/作者匹配 > 其他匹配
 * @param skills 技能列表
 * @param query 搜索关键词（空格分隔多条件）
 */
export function searchMarketplaceSkills(skills: MarketplaceSkill[], query: string): MarketplaceSkill[] {
    if (!query || query.trim() === '') {
        return skills;
    }

    // 分割搜索条件（空格分隔），过滤空字符串
    const terms = query.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) {
        return skills;
    }

    // 检查单个条件是否匹配某个字段
    const matchTerm = (text: string | undefined, term: string): boolean => {
        return text ? text.toLowerCase().includes(term) : false;
    };

    // 检查所有条件是否都匹配某个搜索范围
    const allTermsMatch = (skill: MarketplaceSkill, terms: string[], checkName: boolean, checkAuthor: boolean, checkOther: boolean): boolean => {
        return terms.every(term => {
            // 检查名称
            if (checkName && matchTerm(skill.name, term)) return true;
            // 检查作者/来源
            if (checkAuthor && matchTerm(skill.author, term)) return true;
            // 检查其他字段
            if (checkOther) {
                if (matchTerm(skill.description, term)) return true;
                if (matchTerm(skill.descriptionZh, term)) return true;
                if (skill.tags?.some(tag => matchTerm(tag, term))) return true;
            }
            return false;
        });
    };

    // 计算优先级分数（越高越靠前）
    const getPriority = (skill: MarketplaceSkill): number => {
        const nameLower = skill.name.toLowerCase();
        const authorLower = skill.author.toLowerCase();

        // 优先级1（最高）：所有搜索条件都在名称中找到
        const allInName = terms.every(term => nameLower.includes(term));
        if (allInName) return 3;

        // 优先级2：名称部分匹配，作者/来源也匹配
        const anyInName = terms.some(term => nameLower.includes(term));
        const anyInAuthor = terms.some(term => authorLower.includes(term));
        if (anyInName && anyInAuthor) return 2;

        // 优先级3：名称部分匹配
        if (anyInName) return 1;

        // 优先级4：仅作者/来源匹配，或其他字段匹配
        return 0;
    };

    // 过滤：所有条件必须至少在某个字段中匹配
    const filtered = skills.filter(skill => {
        return allTermsMatch(skill, terms, true, true, true);
    });

    // 按优先级排序
    filtered.sort((a, b) => {
        const priorityA = getPriority(a);
        const priorityB = getPriority(b);
        if (priorityB !== priorityA) {
            return priorityB - priorityA;  // 高优先级在前
        }
        // 同优先级按 stars 排序
        return (b.stars || 0) - (a.stars || 0);
    });

    return filtered;
}

/**
 * 按星标数排序技能
 * @param skills 技能列表
 * @param ascending 是否升序
 */
export function sortByStars(skills: MarketplaceSkill[], ascending: boolean = false): MarketplaceSkill[] {
    return [...skills].sort((a, b) => ascending ? a.stars - b.stars : b.stars - a.stars);
}

/**
 * 按更新时间排序技能
 * @param skills 技能列表
 * @param ascending 是否升序
 */
export function sortByUpdatedAt(skills: MarketplaceSkill[], ascending: boolean = false): MarketplaceSkill[] {
    return [...skills].sort((a, b) => {
        const timeA = a.updatedAt || 0;
        const timeB = b.updatedAt || 0;
        return ascending ? timeA - timeB : timeB - timeA;
    });
}

/**
 * 获取热门技能（按星标数前N个）
 * @param skills 技能列表
 * @param limit 数量限制
 */
export function getTopSkills(skills: MarketplaceSkill[], limit: number = 50): MarketplaceSkill[] {
    return sortByStars(skills).slice(0, limit);
}

/**
 * 从市场安装技能
 * 注意：市场安装只会将技能复制到中央仓，不会添加到GitHub来源管理列表
 * 如需添加到来源管理，请使用"从GitHub导入"功能
 * @param skill 市场技能
 */
export async function installMarketplaceSkill(skill: MarketplaceSkill): Promise<{ success: boolean; message: string }> {
    if (!skill.githubUrl) {
        return { success: false, message: '技能没有有效的 GitHub URL' };
    }

    try {
        // 解析 GitHub URL
        const urlMatch = skill.githubUrl.match(/github\.com\/([^\/]+)\/([^\/\s#?]+)/i);
        if (!urlMatch) {
            return { success: false, message: `无效的 GitHub URL: ${skill.githubUrl}` };
        }
        const owner = urlMatch[1];
        const repo = urlMatch[2].replace(/\.git$/i, '');

        // 使用临时目录克隆仓库
        const tempDir = path.join(os.tmpdir(), `skill-install-${Date.now()}`);

        try {
            // 克隆仓库
            const cloneUrl = `https://github.com/${owner}/${repo}.git`;
            const branch = skill.branch || 'main';

            await execAsync(`git clone --depth 1 --branch "${branch}" "${cloneUrl}" "${tempDir}"`).catch(async () => {
                // 如果 main 分支失败，尝试 master
                await execAsync(`git clone --depth 1 --branch "master" "${cloneUrl}" "${tempDir}"`);
            });

            // 确定要扫描的目录
            let scanRoot = tempDir;
            if (skill.path && skill.path !== '.') {
                scanRoot = path.join(tempDir, skill.path);
            }

            // 如果指定路径不存在，尝试常见目录
            if (!fs.existsSync(scanRoot)) {
                const possiblePaths = [
                    path.join(tempDir, 'skills'),
                    path.join(tempDir, '.claude', 'skills'),
                    path.join(tempDir, '.agent', 'skills'),
                ];
                for (const p of possiblePaths) {
                    if (fs.existsSync(p)) {
                        scanRoot = p;
                        break;
                    }
                }
            }

            // 导入技能到中央仓
            const enabledPath = getSkillsPath();
            const disabledPath = getDisabledPath();

            // 确保目录存在
            if (!fs.existsSync(enabledPath)) {
                await fs.promises.mkdir(enabledPath, { recursive: true });
            }
            if (!fs.existsSync(disabledPath)) {
                await fs.promises.mkdir(disabledPath, { recursive: true });
            }

            let installedCount = 0;

            // 检查根目录是否就是一个技能
            if (fs.existsSync(path.join(scanRoot, 'SKILL.md'))) {
                const skillName = skill.name || path.basename(scanRoot);
                // 检查是否已存在于激活目录（不覆盖激活目录的技能）
                const enabledSkillPath = path.join(enabledPath, skillName);
                const disabledSkillPath = path.join(disabledPath, skillName);

                if (fs.existsSync(enabledSkillPath)) {
                    // 已存在于激活目录，覆盖
                    await copyDirectory(scanRoot, enabledSkillPath);
                } else {
                    // 新技能或已存在于未激活目录，放到未激活目录
                    await copyDirectory(scanRoot, disabledSkillPath);
                }
                installedCount = 1;
            } else if (fs.existsSync(scanRoot)) {
                // 扫描子目录查找技能
                const entries = await fs.promises.readdir(scanRoot, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() && !entry.name.startsWith('.')) {
                        const skillDir = path.join(scanRoot, entry.name);
                        if (fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
                            const skillName = entry.name;
                            const enabledSkillPath = path.join(enabledPath, skillName);
                            const disabledSkillPath = path.join(disabledPath, skillName);

                            if (fs.existsSync(enabledSkillPath)) {
                                // 已存在于激活目录，覆盖
                                await copyDirectory(skillDir, enabledSkillPath);
                            } else {
                                // 新技能，放到未激活目录
                                await copyDirectory(skillDir, disabledSkillPath);
                            }
                            installedCount++;
                        }
                    }
                }
            }

            // 清理临时目录
            await fs.promises.rm(tempDir, { recursive: true, force: true });

            if (installedCount > 0) {
                return {
                    success: true,
                    message: `成功安装 ${skill.name} (${installedCount} 个技能)`
                };
            } else {
                return {
                    success: false,
                    message: `未找到有效的技能（需要包含 SKILL.md 文件）`
                };
            }
        } catch (error) {
            // 清理临时目录
            if (fs.existsSync(tempDir)) {
                await fs.promises.rm(tempDir, { recursive: true, force: true });
            }
            throw error;
        }
    } catch (error) {
        console.error('Failed to install marketplace skill:', error);
        return {
            success: false,
            message: error instanceof Error ? error.message : '安装失败'
        };
    }
}

// 执行命令的辅助函数
async function execAsync(command: string): Promise<string> {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
        exec(command, { maxBuffer: 10 * 1024 * 1024 }, (error: Error | null, stdout: string, stderr: string) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout);
            }
        });
    });
}

/**
 * 检查技能是否已安装
 * @param skill 市场技能
 * @param installedUrls 已安装的 GitHub URL 列表
 */
export function isSkillInstalled(skill: MarketplaceSkill, installedUrls: string[]): boolean {
    if (!skill.githubUrl) {
        return false;
    }
    return installedUrls.some(url => {
        // 规范化比较（移除 .git 后缀和尾部斜杠）
        const normalizedSkill = skill.githubUrl.replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
        const normalizedInstalled = url.replace(/\.git$/i, '').replace(/\/$/, '').toLowerCase();
        return normalizedSkill === normalizedInstalled;
    });
}

/**
 * 获取本地化描述
 * @param skill 市场技能
 * @param language 语言代码 ('zh' 或 'en')
 */
export function getLocalizedDescription(skill: MarketplaceSkill, language: string = 'zh'): string {
    if (language === 'zh' && skill.descriptionZh) {
        return skill.descriptionZh;
    }
    if (language === 'en' && skill.descriptionEn) {
        return skill.descriptionEn;
    }
    return skill.description || '';
}

/**
 * 格式化星标数
 * @param stars 星标数
 */
export function formatStars(stars: number): string {
    if (stars >= 1000) {
        return (stars / 1000).toFixed(1) + 'k';
    }
    return stars.toString();
}

/**
 * 格式化更新时间
 * @param timestamp 时间戳
 */
export function formatUpdatedAt(timestamp?: number): string {
    if (!timestamp) {
        return '';
    }

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return '今天';
    } else if (diffDays === 1) {
        return '昨天';
    } else if (diffDays < 7) {
        return `${diffDays} 天前`;
    } else if (diffDays < 30) {
        return `${Math.floor(diffDays / 7)} 周前`;
    } else if (diffDays < 365) {
        return `${Math.floor(diffDays / 30)} 个月前`;
    } else {
        return `${Math.floor(diffDays / 365)} 年前`;
    }
}

/**
 * 清除市场缓存
 */
export function clearMarketplaceCache(): void {
    marketplaceCache = [];
    lastFetchTime = 0;
}
