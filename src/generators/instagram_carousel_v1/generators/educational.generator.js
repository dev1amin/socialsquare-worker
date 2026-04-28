import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';
import { buildOriginalText, buildContextText } from '../utils/contentBuilder.js';

/**
 * Educational Generator: carrossÃ©is educacionais estratÃ©gicos
 * Foco em clareza operacional e leitura sistÃªmica
 * NOVO: Suporta mÃºltiplas fontes de conteÃºdo (multifont)
 */
export class EducationalGenerator {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async generate(blueprint, content, template, input) {
        try {
            // NOVO: Inclui textos adicionais no contexto
            const originalText = buildOriginalText(content, input);
            const contextText = buildContextText(input);
            
            logger.debug(`[educational] Original text length: ${originalText.length}, context length: ${contextText.length}`);
            
            const screenCount = input.screen_count || template.slides.length;
            // extendedMask is used by the orchestrator AFTER generation to flatten title-only slides.
            // We pass all-true to the model so it always generates both title and subtitle.
            const baseMask = template.slides.map(s => !!s.subtitle);
            const extendedMask = Array.from({ length: screenCount }, (_, i) => baseMask[i % baseMask.length]);
            const allTrueMask = Array(screenCount).fill(true);
            const extendedTemplate = template.slides; // Real template for better rhythm/style

            const { system, user } = await PromptLoader.loadBoth('educational', {
                blueprint_json: JSON.stringify(blueprint, null, 2),
                original_text: originalText,
                context: contextText,
                template_json: JSON.stringify(extendedTemplate),
                slides_mask: JSON.stringify(allTrueMask),
                screen_count: screenCount,
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

            recordTokens(this.tokenTracker, 'educational_generator', completion);

            const result = JSON.parse(completion.choices[0].message.content);
            logger.debug(`Educational generator created ${result.slides?.length || 0} slides`);

            return result.slides || [];
        } catch (error) {
            const err = new Error(`Educational generator failed: ${error.message}`);
            err.stage = 'educational_generator';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
