import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * TitleSquashAgent: para slides onde o template não prevê subtitle,
 * re-gera um único title autossuficiente a partir do title+subtitle gerados pelo GPT.
 * Evita concatenação mecânica — usa uma segunda passagem de geração inteligente.
 */
export class TitleSquashAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async squash(slides, baseMask) {
        // Identify title-only slots where GPT generated a subtitle but template doesn't use it
        const titleOnlySlides = slides
            .map((s, i) => ({ s, i }))
            .filter(({ s, i }) => !baseMask[i % baseMask.length] && s.subtitle);

        if (titleOnlySlides.length === 0) return slides;

        logger.debug(`[titleSquash] Squashing ${titleOnlySlides.length} title-only slides`);

        const payload = titleOnlySlides.map(({ s, i }) => ({
            index: i,
            title: s.title,
            subtitle: s.subtitle,
        }));

        const { system, user } = await PromptLoader.loadBoth('titleSquash', {
            slides_json: JSON.stringify(payload, null, 2),
        });

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.5,
        });

        if (this.tokenTracker) {
            recordTokens(this.tokenTracker, 'title_squash', completion);
        }

        const result = JSON.parse(completion.choices[0].message.content);
        const squashed = result.slides || [];

        const output = [...slides];
        for (const { index, title } of squashed) {
            if (typeof index === 'number' && typeof title === 'string' && title.trim()) {
                output[index] = { ...output[index], title: title.trim(), subtitle: undefined };
            }
        }

        logger.debug(`[titleSquash] Applied ${squashed.length} squashed titles`);
        return output;
    }
}
