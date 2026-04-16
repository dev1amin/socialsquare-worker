import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Keyword Agent: adiciona keywords em inglês para busca de imagens no Unsplash
 * Keywords devem ser visuais, concretas e retornar boas fotos
 */
export class KeywordAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async addKeywords(slides, input) {
        try {
            logger.debug(`[keyword] Generating keywords for ${slides.length} slides, theme: ${input?.content_type || 'unknown'}`);

            const theme = input?.topic || input?.content_type || 'general';

            const { system, user } = await PromptLoader.loadBoth('keyword', {
                slides_json: JSON.stringify(slides),
                slides_count: slides.length,
                theme: theme,
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini', // Usa modelo mais barato para tarefa simples
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
            });

            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'keyword_agent', completion);
            }

            const result = JSON.parse(completion.choices[0].message.content);
            logger.debug(`Added keywords to ${result.slides?.length || 0} slides`);

            return result.slides || slides;
        } catch (error) {
            const err = new Error(`Keyword generation failed: ${error.message}`);
            err.stage = 'keyword';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
