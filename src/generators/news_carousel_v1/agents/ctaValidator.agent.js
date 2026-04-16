import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * CTA Validator Agent: garante que o último slide tenha um CTA contextual e de qualidade
 */
export class CTAValidatorAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Garante que o último slide tenha um CTA bem contextualizado
     * @param {Array} slides - Slides gerados
     * @param {Object} input - Input do job (cta_type, cta_intention)
     * @param {Object} blueprint - Blueprint com tema_central da notícia
     */
    async ensureCTA(slides, input = {}, blueprint = {}) {
        try {
            if (slides.length === 0) {
                return slides;
            }

            const cta_type = input.cta_type || 'comentar';
            const cta_intention = input.cta_intention || 'engajamento';
            const topic = blueprint.tema_central || blueprint.mensagem_principal || 'notícia';

            logger.debug(`[cta-validator] Generating contextual CTA: type=${cta_type}, intention=${cta_intention}, topic="${topic}"`);

            const { system, user } = await PromptLoader.loadBoth('ctaValidator', {
                topic,
                cta_type,
                cta_intention,
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.6,
            });

            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'cta_validator', completion);
            }

            const ctaSlide = JSON.parse(completion.choices[0].message.content);

            if (!ctaSlide.title) {
                logger.warn('[cta-validator] AI returned invalid CTA, keeping existing last slide');
                return slides;
            }

            // Substitui o último slide pelo CTA gerado pela IA
            const updatedSlides = [...slides];
            const lastSlide = updatedSlides[updatedSlides.length - 1];
            updatedSlides[updatedSlides.length - 1] = {
                ...lastSlide,
                title: ctaSlide.title,
                subtitle: ctaSlide.subtitle || lastSlide.subtitle,
                keyword: '',
            };

            logger.debug(`[cta-validator] CTA slide updated: "${ctaSlide.title}"`);
            return updatedSlides;
        } catch (error) {
            logger.warn(`[cta-validator] CTA generation failed, keeping existing slides: ${error.message}`);
            // Não lança erro — prefere manter slides existentes a derrubar o job
            return slides;
        }
    }
}
