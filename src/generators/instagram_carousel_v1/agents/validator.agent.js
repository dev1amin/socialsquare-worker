import { logger } from '../../../config/logger.js';
import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { PromptLoader } from '../utils/promptLoader.js';

/**
 * Validator Agent: valida schema, qualidade e tenta corrigir se necessário
 */
export class ValidatorAgent {
    async validate(draft) {
        try {
            // 1. Validação estrutural básica
            this.validateStructure(draft);

            // 2. Validação de qualidade (slides vazios, muito curtos, etc)
            const issues = this.findQualityIssues(draft);

            if (issues.length > 0) {
                logger.warn(`Validator found ${issues.length} issues, attempting correction...`);
                return await this.attemptCorrection(draft, issues);
            }

            logger.debug('Validator: content passed all checks');
            return draft;
        } catch (error) {
            const err = new Error(`Validator failed: ${error.message}`);
            err.stage = 'validator';
            err.retryable = false; // Erros de validação não são recuperáveis
            throw err;
        }
    }

    validateStructure(draft) {
        if (!draft.slides || !Array.isArray(draft.slides)) {
            throw new Error('Invalid structure: slides must be an array');
        }

        if (draft.slides.length === 0) {
            throw new Error('Invalid structure: no slides generated');
        }

        if (!draft.caption || typeof draft.caption !== 'string') {
            throw new Error('Invalid structure: caption is required');
        }

        for (const slide of draft.slides) {
            if (!slide.title || !slide.body) {
                throw new Error(`Invalid slide ${slide.index}: missing title or body`);
            }
        }
    }

    findQualityIssues(draft) {
        const issues = [];

        // Verifica slides muito curtos
        for (const slide of draft.slides) {
            if (slide.body.length < 10) {
                issues.push(`Slide ${slide.index} has very short body`);
            }
            if (slide.title.length < 3) {
                issues.push(`Slide ${slide.index} has very short title`);
            }
        }

        // Verifica caption
        if (draft.caption.length < 20) {
            issues.push('Caption is too short');
        }

        // Verifica hashtags
        if (!draft.hashtags || draft.hashtags.length < 3) {
            issues.push('Not enough hashtags');
        }

        return issues;
    }

    async attemptCorrection(draft, issues) {
        try {
            const { system, user } = await PromptLoader.loadBoth('validator', {
                issues: issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n'),
                draft_json: JSON.stringify(draft, null, 2),
            });

            const completion = await openai.chat.completions.create({
                model: config.openai.model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.5,
            });

            const corrected = JSON.parse(completion.choices[0].message.content);

            // Valida novamente
            this.validateStructure(corrected);
            const remainingIssues = this.findQualityIssues(corrected);

            if (remainingIssues.length > 0) {
                throw new Error(`Correction failed: ${remainingIssues.join(', ')}`);
            }

            logger.info('Validator: content corrected successfully');
            return corrected;
        } catch (error) {
            throw new Error(`Correction attempt failed: ${error.message}`);
        }
    }
}
