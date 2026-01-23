import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Skill 备注数据结构
 */
export interface SkillNote {
    skillId: string;        // 技能唯一标识 (文件名)
    note: string;           // 备注内容
    createdAt: number;      // 创建时间
    updatedAt: number;      // 更新时间
}

/**
 * 获取备注文件路径
 */
function getNotesFilePath(): string {
    return path.join(os.homedir(), '.agent', '.skill-notes.json');
}

/**
 * 读取所有备注
 */
export async function getAllNotes(): Promise<Record<string, SkillNote>> {
    const filePath = getNotesFilePath();
    try {
        if (fs.existsSync(filePath)) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.error('读取备注文件失败:', error);
    }
    return {};
}

/**
 * 保存所有备注
 */
async function saveAllNotes(notes: Record<string, SkillNote>): Promise<void> {
    const filePath = getNotesFilePath();
    const dir = path.dirname(filePath);

    // 确保目录存在
    if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
    }

    await fs.promises.writeFile(filePath, JSON.stringify(notes, null, 2), 'utf-8');
}

/**
 * 生成 Skill 唯一标识
 * 使用文件名作为唯一标识（去除 .md 扩展名）
 */
export function getSkillId(skillName: string): string {
    // 去除 .md 扩展名（如果有）
    return skillName.replace(/\.md$/, '');
}

/**
 * 获取单个 Skill 的备注
 */
export async function getSkillNote(skillName: string): Promise<string | null> {
    const skillId = getSkillId(skillName);
    const notes = await getAllNotes();
    return notes[skillId]?.note || null;
}

/**
 * 设置/更新 Skill 备注
 */
export async function setSkillNote(skillName: string, note: string): Promise<void> {
    const skillId = getSkillId(skillName);
    const notes = await getAllNotes();
    const now = Date.now();

    if (notes[skillId]) {
        // 更新现有备注
        notes[skillId].note = note;
        notes[skillId].updatedAt = now;
    } else {
        // 创建新备注
        notes[skillId] = {
            skillId,
            note,
            createdAt: now,
            updatedAt: now
        };
    }

    await saveAllNotes(notes);
}

/**
 * 删除 Skill 备注
 */
export async function deleteSkillNote(skillName: string): Promise<void> {
    const skillId = getSkillId(skillName);
    const notes = await getAllNotes();

    if (notes[skillId]) {
        delete notes[skillId];
        await saveAllNotes(notes);
    }
}

/**
 * 批量获取多个 Skills 的备注
 */
export async function getSkillNotes(skillNames: string[]): Promise<Record<string, string>> {
    const notes = await getAllNotes();
    const result: Record<string, string> = {};

    for (const name of skillNames) {
        const skillId = getSkillId(name);
        if (notes[skillId]) {
            result[name] = notes[skillId].note;
        }
    }

    return result;
}
