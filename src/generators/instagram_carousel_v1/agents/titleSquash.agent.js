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

    formatLongTextParagraphs(text, originalSlide) {
        const normalized = String(text || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        const explicitParagraphs = normalized
            .split(/\n{2,}/)
            .map(part => part.trim())
            .filter(Boolean);

        const sourceParagraphs = explicitParagraphs.length > 1
            ? explicitParagraphs
            : normalized.split(/(?<=[.!?])\s+/).map(part => part.trim()).filter(Boolean);

        const compactParagraphs = [];
        for (let index = 0; index < sourceParagraphs.length; index += 2) {
            compactParagraphs.push(sourceParagraphs.slice(index, index + 2).join(' ').trim());
        }

        const paragraphs = compactParagraphs.filter(Boolean);
        if (paragraphs.length > 0) return paragraphs.join('\n\n').trim();

        const fallbackTitle = (originalSlide?.title || '').trim();
        const fallbackSubtitle = (originalSlide?.subtitle || '').trim();
        return [fallbackTitle, fallbackSubtitle].filter(Boolean).join('\n\n').trim();
    }

    normalizeTitleOutput(title, originalSlide, { longText = false, denseTitle = false } = {}) {
        const normalized = String(title || '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        if (!normalized) {
            const fallbackTitle = (originalSlide?.title || '').trim();
            const fallbackSubtitle = (originalSlide?.subtitle || '').trim();
            if (longText && fallbackSubtitle) {
                return [fallbackTitle, fallbackSubtitle].filter(Boolean).join('\n\n').trim();
            }
            if (fallbackSubtitle) {
                const separator = /[.!?:;]$/.test(fallbackTitle) ? ' ' : '. ';
                return [fallbackTitle, fallbackSubtitle].filter(Boolean).join(separator).trim();
            }
            return fallbackTitle;
        }

        if (longText) {
            return this.formatLongTextParagraphs(normalized, originalSlide);
        }

        if (denseTitle) {
            const wordCount = normalized.split(/\s+/).filter(Boolean).length;
            const fallbackSubtitle = (originalSlide?.subtitle || '').trim();
            if (wordCount < 10 && fallbackSubtitle) {
                const separator = /[.!?:;]$/.test(normalized) ? ' ' : '. ';
                return [normalized, fallbackSubtitle].filter(Boolean).join(separator).trim();
            }
        }

        return normalized;
    }

    async squash(slides, baseMask, options = {}) {
        const {
            longTextIndices = new Set(),
            denseTitleIndices = new Set(),
            rewriteAllTitleOnly = false,
            sourceContext = '',
        } = options;

        // Identify title-only slots where GPT generated a subtitle but template doesn't use it
        const titleOnlySlides = slides
            .map((s, i) => ({ s, i }))
            .filter(({ s, i }) => {
                if (baseMask[i % baseMask.length]) return false;
                return rewriteAllTitleOnly || !!s.subtitle || longTextIndices.has(i) || denseTitleIndices.has(i);
            });

        if (titleOnlySlides.length === 0) return slides;

        logger.debug(`[titleSquash] Squashing ${titleOnlySlides.length} title-only slides`);

        const payload = titleOnlySlides.map(({ s, i }) => ({
            index: i,
            title: s.title || '',
            subtitle: s.subtitle || '',
            long_text: longTextIndices.has(i),
            dense_title: denseTitleIndices.has(i),
        }));
        const originalByIndex = new Map(titleOnlySlides.map(({ s, i }) => [i, s]));

        const { system, user } = await PromptLoader.loadBoth('titleSquash', {
            slides_json: JSON.stringify(payload, null, 2),
            source_context: sourceContext || '',
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
                const originalSlide = originalByIndex.get(index) || output[index];
                output[index] = {
                    ...output[index],
                    title: this.normalizeTitleOutput(title, originalSlide, {
                        longText: longTextIndices.has(index),
                        denseTitle: denseTitleIndices.has(index),
                    }),
                    subtitle: undefined,
                };
            }
        }

        logger.debug(`[titleSquash] Applied ${squashed.length} squashed titles`);
        return output;
    }
}
