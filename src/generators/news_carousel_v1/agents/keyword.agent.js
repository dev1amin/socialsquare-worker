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

            // Registra tokens
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
     * For News: prefers the raw article htmlText, then combinedSources, then context.
     */
    _buildSourceContext(input) {
        if (!input) return '';

        // Explicitly provided by orchestrator (preferred)
        if (input.source_context && typeof input.source_context === 'string') {
            return input.source_context.substring(0, 2500);
        }

        // Raw article HTML text (scraped by News orchestrator)
        if (input.htmlText && typeof input.htmlText === 'string') {
            return input.htmlText.substring(0, 2500);
        }

        const parts = [];

        if (Array.isArray(input.combinedSources)) {
            for (const src of input.combinedSources) {
                if (src?.content && typeof src.content === 'string' && src.content.trim()) {
                    if (src.type === 'research') continue;
                    parts.push(src.content.trim());
                }
            }
        }

        if (parts.length === 0 && input.context) parts.push(input.context);

        const combined = parts.join('\n---\n');
        return combined.substring(0, 2500);
    }
}
