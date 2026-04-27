import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';
import { buildOriginalText, buildContextText } from '../utils/contentBuilder.js';

/**
 * Case Generator: leitura estratÃ©gica aplicada baseada em fatos
 * Protagonista Ã© a DECISÃƒO ESTRUTURAL
 * NOVO: Suporta mÃºltiplas fontes de conteÃºdo (multifont)
 */
export class CaseGenerator {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async generate(blueprint, content, template, input) {
        try {
            // NOVO: Usa helpers para construir texto combinado de todas as fontes
            const originalText = buildOriginalText(content, input);
            const contextText = buildContextText(input);
            
            logger.debug(`[case] Original text length: ${originalText.length}, context length: ${contextText.length}`);
            
            const screenCount = input.screen_count || template.slides.length;
            const baseMask = template.slides.map(s => !!s.subtitle);
            const extendedMask = Array.from({ length: screenCount }, (_, i) => baseMask[i % baseMask.length]);
            const extendedTemplate = template.slides; // Real template for better rhythm/style

            const { system, user } = await PromptLoader.loadBoth('case', {
                original_text: originalText,
                context: contextText,
                template_json: JSON.stringify(extendedTemplate),
                slides_mask: JSON.stringify(extendedMask.map(() => true)), // modelo sempre gera subtitle
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

            recordTokens(this.tokenTracker, 'case_generator', completion);

            const result = JSON.parse(completion.choices[0].message.content);
            logger.debug(`Case generator created ${result.slides?.length || 0} slides`);

            // Merge title+subtitle para slides onde o template não tem subtitle
            const rawSlides = result.slides || [];
            return rawSlides.map((slide, i) => {
                if (!extendedMask[i] && slide.subtitle) {
                    return { ...slide, title: `${slide.title} ${slide.subtitle}`, subtitle: null };
                }
                return slide;
            });
        } catch (error) {
            const err = new Error(`Case generator failed: ${error.message}`);
            err.stage = 'case_generator';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
