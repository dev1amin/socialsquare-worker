import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Blueprint Generator Agent (News)
 * Recebe HTML extraído de URLs e gera 42 chaves do blueprint narrativo
 */
export class BlueprintGeneratorAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Analisa HTML e gera blueprint de 42 chaves
     * @param {Object} params
     * @param {string} params.htmlText - HTML limpo da notícia
     * @param {string} params.context - Contexto adicional do usuário
     * @returns {Promise<Object>} Blueprint com 42 chaves
     */
    async analyze({ htmlText, context }) {
        try {
            logger.info('[news-analyzer] Generating blueprint from HTML');

            // Carrega prompts
            const systemPrompt = await PromptLoader.loadSystem('blueprintGenerator');
            const userPrompt = await PromptLoader.loadUser('blueprintGenerator', {
                news_html: htmlText
            });

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            });

            // Registra tokens
            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'blueprint_generator', response);
            }

            const blueprint = JSON.parse(response.choices[0]?.message?.content);

            if (!blueprint || Object.keys(blueprint).length !== 42) {
                throw new Error(`Invalid blueprint: expected 42 keys, got ${Object.keys(blueprint).length}`);
            }

            logger.info('[news-analyzer] Blueprint generated successfully', { keys: Object.keys(blueprint).length });
            return blueprint;
        } catch (error) {
            logger.error('[news-analyzer] Failed to generate blueprint', { error: error.message });
            throw error;
        }
    }
}
