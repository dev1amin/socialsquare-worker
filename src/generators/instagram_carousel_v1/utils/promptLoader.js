import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../../config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.join(__dirname, '../prompts');

/**
 * Cache de prompts carregados
 */
const promptCache = new Map();

/**
 * Carrega um arquivo de prompt (agora com suporte a subpastas)
 * Estrutura: prompts/{agentName}/{agentName}.{type}.txt
 */
async function loadPromptFile(agentName, type) {
    const cacheKey = `${agentName}.${type}`;

    if (promptCache.has(cacheKey)) {
        return promptCache.get(cacheKey);
    }

    try {
        const filePath = path.join(promptsDir, agentName, `${agentName}.${type}.txt`);
        const content = await fs.readFile(filePath, 'utf-8');
        promptCache.set(cacheKey, content.trim());
        logger.debug(`Loaded prompt: ${agentName}/${agentName}.${type}.txt`);
        return content.trim();
    } catch (error) {
        logger.error(`Failed to load prompt ${agentName}.${type}: ${error.message}`);
        throw new Error(`Prompt file not found: ${agentName}/${agentName}.${type}.txt`);
    }
}

/**
 * Interpola variáveis no template do prompt
 * Usa sintaxe {{variavel}} para substituição
 */
function interpolate(template, variables) {
    let result = template;

    for (const [key, value] of Object.entries(variables)) {
        const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        result = result.replace(placeholder, value ?? 'N/A');
    }

    return result;
}

/**
 * Loader de prompts para agentes
 */
export class PromptLoader {
    /**
     * Carrega prompt system de um agente
     */
    static async loadSystem(agentName) {
        return await loadPromptFile(agentName, 'system');
    }

    /**
     * Carrega prompt user de um agente com interpolação de variáveis
     */
    static async loadUser(agentName, variables = {}) {
        const template = await loadPromptFile(agentName, 'user');
        return interpolate(template, variables);
    }

    /**
     * Carrega ambos system e user
     */
    static async loadBoth(agentName, variables = {}) {
        const [system, user] = await Promise.all([
            this.loadSystem(agentName),
            this.loadUser(agentName, variables),
        ]);

        return { system, user };
    }

    /**
     * Limpa cache (útil em desenvolvimento)
     */
    static clearCache() {
        promptCache.clear();
        logger.debug('Prompt cache cleared');
    }
}
