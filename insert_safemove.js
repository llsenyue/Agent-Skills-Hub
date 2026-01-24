const fs = require('fs');
const path = require('path');

const filePath = 'f:/backup/home/llsenyue/project/Skills-Manager/skill-manager-extension/src/utils/skillWarehouse.ts';

// 读取文件
const content = fs.readFileSync(filePath, 'utf-8');
const lines = content.split('\r\n');

// safeMove 函数代码
const safeMoveFunction = `/**
 * 安全移动目录（带重试和降级策略）
 * @param src 源路径
 * @param dest 目标路径
 * @param maxRetries 最大重试次数
 */
async function safeMove(src: string, dest: string, maxRetries: number = 3): Promise<void> {
    // 如果目标已存在，先删除
    if (fs.existsSync(dest)) {
        await fs.promises.rm(dest, { recursive: true, force: true });
    }

    let lastError: any;
    
    // 策略1: 尝试直接 rename（最快）
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await fs.promises.rename(src, dest);
            return; // 成功
        } catch (error: any) {
            lastError = error;
            
            // 如果是 EPERM 或 EBUSY 错误（文件被锁定），等待后重试
            if (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY') {
                console.log(\`[safeMove] Attempt \${attempt + 1}/\${maxRetries} failed: \${error.code}, retrying...\`);
                
                if (attempt < maxRetries - 1) {
                    // 等待一小段时间后重试
                    await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
                    continue;
                }
            } else {
                // 其他错误直接抛出
                throw error;
            }
        }
    }
    
    // 策略2: 如果 rename 失败，使用复制+删除降级方案
    console.log(\`[safeMove] Falling back to copy+delete strategy due to: \${lastError?.code}\`);
    
    try {
        // 复制目录到目标位置
        await copyDirectory(src, dest);
        
        // 短暂延迟，让文件系统释放句柄
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 尝试删除源目录（带重试）
        let deleteSuccess = false;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                await fs.promises.rm(src, { recursive: true, force: true });
                deleteSuccess = true;
                break;
            } catch (error: any) {
                console.log(\`[safeMove] Delete attempt \${attempt + 1}/3 failed: \${error.code}\`);
                if (attempt < 2) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
        }
        
        if (!deleteSuccess) {
            console.warn(\`[safeMove] Warning: Failed to delete source directory: \${src}. Files were copied successfully to: \${dest}\`);
            // 不抛出错误，因为复制成功了，只是源目录删除失败
            // 用户可以手动删除源目录
        }
    } catch (error: any) {
        // 如果复制也失败了，清理可能部分复制的目标目录
        if (fs.existsSync(dest)) {
            try {
                await fs.promises.rm(dest, { recursive: true, force: true });
            } catch { }
        }
        throw new Error(\`无法移动目录: \${error.message}。请关闭可能正在使用该技能文件的程序（如编辑器、终端等）后重试。\`);
    }
}
`;

// 在144行之后插入 safeMove 函数
lines.splice(144, 0, '', ...safeMoveFunction.split('\n'));

// 写回文件
fs.writeFileSync(filePath, lines.join('\r\n'), 'utf-8');

console.log('✓ safeMove 函数已成功添加到 skillWarehouse.ts');
