import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * System Generator (News): mecanismo composto de fases
 * Protagonista é o FLUXO OU PROCESSO
 */
export class SystemGenerator {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async generate(blueprint, htmlText, template, input) {
        try {
            const screenCount = input.screen_count || template.slides.length;
            // extendedMask is used by the orchestrator AFTER generation to flatten title-only slides.
            // We pass all-true to the model so it always generates both title and subtitle.
            const baseMask = template.slides.map(s => !!s.subtitle);
            const extendedMask = Array.from({ length: screenCount }, (_, i) => baseMask[i % baseMask.length]);
            const allTrueMask = Array(screenCount).fill(true);
            // Pass real template slides so GPT sees actual rhythm, style and structure
            const extendedTemplate = template.slides;

            const { system, user } = await PromptLoader.loadBoth('system', {
                blueprint_json: JSON.stringify(blueprint),
                context: input.context || '',
                template_json: JSON.stringify(extendedTemplate),
                slides_mask: JSON.stringify(allTrueMask),
                screen_count: screenCount,
                news_text: htmlText ? htmlText.substring(0, 3000) : '',
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7,
            });

            // Registra tokens
            recordTokens(this.tokenTracker, 'system_generator', completion);

            const result = JSON.parse(completion.choices[0].message.content);
            logger.debug(`System generator created ${result.slides?.length || 0} slides`);

            return result.slides || [];
        } catch (error) {
            const err = new Error(`System generator failed: ${error.message}`);
            err.stage = 'system_generator';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
