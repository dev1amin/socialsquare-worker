import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';
import { buildOriginalText, buildContextText } from '../utils/contentBuilder.js';

/**
 * Story Generator: carrosséis em formato de história ancorada
 * História serve para exemplificar, não substituir conteúdo
 * NOVO: Suporta múltiplas fontes de conteúdo (multifont) via content.text combinado
 */
export class StoryGenerator {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async generate(blueprint, content, template, input) {
        try {
            // NOVO: Usa helpers para construir texto combinado de todas as fontes
            // Importante: content.text já vem combinado do orchestrator, additionalTexts vem no input
            const originalText = buildOriginalText(content, input);
            const contextText = buildContextText(input);
            
            // Log detalhado para debug
            logger.info(`[story] Building carousel with ${input.screen_count} slides`);
            logger.info(`[story] Content sources: text=${!!content.text}(${content.text?.length || 0}), caption=${!!content.caption}(${content.caption?.length || 0}), additionalTexts=${input.additionalTexts?.length || input.additional_texts?.length || 0}`);
            logger.info(`[story] Original text length: ${originalText.length}, context length: ${contextText.length}`);
            
            // Log preview do texto para verificar se as fontes estão incluídas
            if (originalText.includes('---')) {
                logger.info(`[story] Multiple sources detected in original text`);
            }
            
            const screenCount = input.screen_count || template.slides.length;
            const baseMask = template.slides.map(s => !!s.subtitle);
            const extendedMask = Array.from({ length: screenCount }, (_, i) => baseMask[i % baseMask.length]);
            const extendedTemplate = Array.from({ length: screenCount }, (_, i) =>
                extendedMask[i] ? { title: '...', subtitle: '...' } : { title: '...' }
            );

            const { system, user } = await PromptLoader.loadBoth('story', {
                original_text: originalText,
                context: contextText,
                template_json: JSON.stringify(extendedTemplate),
                slides_mask: JSON.stringify(extendedMask),
                screen_count: screenCount,
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7,
            });

            recordTokens(this.tokenTracker, 'story_generator', completion);

            const result = JSON.parse(completion.choices[0].message.content);
            
            // Validar quantidade de slides
            const generatedCount = result.slides?.length || 0;
            const expectedCount = input.screen_count || template.slides.length;
            
            if (generatedCount !== expectedCount) {
                logger.warn(`[story] Generated ${generatedCount} slides but expected ${expectedCount}`);
            } else {
                logger.info(`[story] Successfully generated ${generatedCount} slides`);
            }

            return result.slides || [];
        } catch (error) {
            const err = new Error(`Story generator failed: ${error.message}`);
            err.stage = 'story_generator';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
