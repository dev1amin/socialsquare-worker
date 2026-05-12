import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';
import { formatEvidencePackForPrompt } from '../../shared/utils/evidencePack.js';

/**
 * Educational Generator (News): blocos modulares de saber
 * Protagonista é o CONCEITO OU HABILIDADE
 */
export class EducationalGenerator {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async generate(blueprint, htmlText, template, input) {
        try {
            const evidencePackText = formatEvidencePackForPrompt(input.evidencePack);
            const screenCount = input.screen_count || template.slides.length;
            const baseMask = template.slides.map(s => !!s.subtitle);
            const extendedMask = Array.from({ length: screenCount }, (_, i) => baseMask[i % baseMask.length]);
            // Pass real template slides so GPT sees actual rhythm, style and structure
            const extendedTemplate = template.slides;

            const { system, user } = await PromptLoader.loadBoth('educational', {
                blueprint_json: JSON.stringify(blueprint),
                context: input.context || '',
                template_json: JSON.stringify(extendedTemplate),
                slides_mask: JSON.stringify(extendedMask),
                screen_count: screenCount,
                news_text: htmlText ? htmlText.substring(0, 3000) : '',
                evidence_pack: evidencePackText,
                quality_repair_brief: input.qualityRepairBrief || '',
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.45,
            });

            // Registra tokens
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
