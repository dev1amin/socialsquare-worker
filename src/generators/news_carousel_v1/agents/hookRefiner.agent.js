import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

export class HookRefinerAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async refine(slides, evidencePack = null, sourceContext = '') {
        if (!Array.isArray(slides) || slides.length === 0) {
            return slides;
        }

        const firstSlide = slides[0];
        const hookPlan = evidencePack?.slidePlan?.[0] || {};
        const titleOnly = firstSlide?.subtitle === undefined || firstSlide?.subtitle === null;

        const { system, user } = await PromptLoader.loadBoth('hookRefiner', {
            slide_json: JSON.stringify({
                title: firstSlide?.title || '',
                subtitle: firstSlide?.subtitle ?? null,
            }, null, 2),
            title_only: titleOnly ? 'true' : 'false',
            planned_claim: hookPlan.claim || 'N/A',
            required_anchors: Array.isArray(hookPlan.requiredAnchors) && hookPlan.requiredAnchors.length > 0
                ? hookPlan.requiredAnchors.join(', ')
                : 'N/A',
            source_context: sourceContext || 'N/A',
        });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.4,
        });

        if (this.tokenTracker) {
            recordTokens(this.tokenTracker, 'hook_refiner', completion);
        }

        const result = JSON.parse(completion.choices[0].message.content);
        if (!result?.title || !String(result.title).trim()) {
            logger.warn('[hook-refiner] Empty title returned, keeping original slide 1');
            return slides;
        }

        const refinedSlides = [...slides];
        refinedSlides[0] = {
            ...refinedSlides[0],
            title: String(result.title).trim(),
            subtitle: titleOnly
                ? undefined
                : (result.subtitle !== undefined && result.subtitle !== null && result.subtitle !== '')
                    ? String(result.subtitle).trim()
                    : refinedSlides[0].subtitle,
        };

        return refinedSlides;
    }
}