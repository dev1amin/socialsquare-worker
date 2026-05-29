import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedPromptsDir = path.join(__dirname, '../prompts');
const partialCache = new Map();

async function loadPartial(partialName) {
    const cacheKey = `shared:${partialName}`;

    if (partialCache.has(cacheKey)) {
        return partialCache.get(cacheKey);
    }

    const filePath = path.join(sharedPromptsDir, `${partialName}.partial.txt`);
    const content = await fs.readFile(filePath, 'utf-8');
    const trimmed = content.trim();
    partialCache.set(cacheKey, trimmed);
    return trimmed;
}

export async function resolvePromptPartials(template) {
    let resolved = template;
    let previous = null;

    while (resolved !== previous) {
        previous = resolved;
        const partialNames = [...resolved.matchAll(/\{\{>\s*([a-zA-Z0-9_-]+)\s*\}\}/g)]
            .map((match) => match[1]);

        if (partialNames.length === 0) {
            break;
        }

        for (const partialName of partialNames) {
            const partialContent = await loadPartial(partialName);
            resolved = resolved.replace(new RegExp(`\\{\\{>\\s*${partialName}\\s*\\}\\}`, 'g'), partialContent);
        }
    }

    return resolved;
}

export function clearPromptPartialCache() {
    partialCache.clear();
}