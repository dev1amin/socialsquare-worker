import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Keyword Agent: adiciona keywords em inglês para busca de imagens no Unsplash
 * Keywords devem ser visuais, concretas e retornar boas fotos
 */
export class KeywordAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async addKeywords(slides, input) {
        try {
            logger.debug(`[keyword] Generating keywords for ${slides.length} slides, theme: ${input?.content_type || 'unknown'}`);

            const theme = input?.topic || input?.content_type || 'general';

            // Build source_context_section from available source material.
            // This gives the model access to entity names that were in the original
            // content but didn't make it into the short slide title/subtitle.
            const rawContext = this._buildSourceContext(input);
            const source_context_section = rawContext
                ? `\nContexto da fonte original (use para identificar nomes próprios ausentes nos títulos):\n<source_context>\n${rawContext}\n</source_context>\n`
                : '';

            const { system, user } = await PromptLoader.loadBoth('keyword', {
                slides_json: JSON.stringify(slides),
                slides_count: slides.length,
                theme: theme,
                source_context_section,
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini', // Usa modelo mais barato para tarefa simples
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3,
            });

            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'keyword_agent', completion);
            }

            const result = JSON.parse(completion.choices[0].message.content);
            logger.debug(`Added keywords to ${result.slides?.length || 0} slides`);

            return result.slides || slides;
        } catch (error) {
            const err = new Error(`Keyword generation failed: ${error.message}`);
            err.stage = 'keyword';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }

    /**
     * Extracts a compact source context string from the generation input.
     * Priority: explicit source_context > combinedSources captions/articles > post_text > context.
     * Capped at 2500 chars to keep prompt size reasonable.
     */
    _buildSourceContext(input) {
        if (!input) return '';

        // Explicitly provided by orchestrator (preferred)
        if (input.source_context && typeof input.source_context === 'string') {
            return input.source_context.substring(0, 2500);
        }

        const parts = [];

        // Instagram captions / article texts from combinedSources
        if (Array.isArray(input.combinedSources)) {
            for (const src of input.combinedSources) {
                if (src?.content && typeof src.content === 'string' && src.content.trim()) {
                    // Skip pure research summaries (can confuse entity extraction)
                    if (src.type === 'research') continue;
                    parts.push(src.content.trim());
                }
            }
        }

        // Fallback: plain post text
        if (parts.length === 0 && input.post_text) parts.push(input.post_text);
        if (parts.length === 0 && input.article_text) parts.push(input.article_text);
        // Last resort: user context (may still contain entity hints)
        if (parts.length === 0 && input.context) parts.push(input.context);

        const combined = parts.join('\n---\n');
        return combined.substring(0, 2500);
    }
}
