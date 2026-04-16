import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Description Agent
 * Gera descrição final do carrossel baseada nos slides
 */
export class DescriptionAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Gera descrição do carrossel
     * @param {Object} params
     * @param {Array} params.slides - Slides do carrossel
     * @param {Object} params.brandData - Dados da marca
     * @param {string} params.context - Contexto adicional
     * @returns {Promise<string>}
     */
    async generate({ slides, brandData, context, descriptionLength }) {
        try {
            logger.info('[description.agent] Generating carousel description');

            // Carrega prompts (métodos static)
            const systemPrompt = await PromptLoader.loadSystem('description');
            const userPrompt = await PromptLoader.loadUser('description', {
                slides: JSON.stringify(slides.map(s => ({ title: s.title, subtitle: s.subtitle }))),
                brand_positioning: brandData?.brand_positioning || 'N/A',
                voice_tone: brandData?.voice_tone || 'profissional e acessível',
                target_audience: brandData?.target_audience || 'público geral',
                forbidden_words: brandData?.forbidden_words || 'nenhuma',
                preferred_words: brandData?.preferred_words || 'nenhuma',
                forbidden_topics: brandData?.forbidden_topics || 'nenhum',
                objective: brandData?.objective || 'aumentar engajamento',
                description_length: descriptionLength || 'media',
                context: context || 'nenhum contexto adicional'
            });

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.5,
                frequency_penalty: 0.2,
                presence_penalty: 0.1,
                top_p: 0.9
            });

            // Registra tokens
            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'description_agent', response);
            }

            const description = response.choices[0]?.message?.content?.trim();

            if (!description) {
                throw new Error('Empty description returned from OpenAI');
            }

            logger.info('[description.agent] Description generated successfully');
            return description;
        } catch (error) {
            logger.error('[description.agent] Failed to generate description', { error: error.message });
            throw error;
        }
    }
}
