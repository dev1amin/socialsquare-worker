import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

// Max chars of plain text sent to the model.
// ~80 000 chars ≈ ~20 000 tokens — well inside gpt-4o-mini's 128 K context.
const MAX_HTML_CHARS = 80_000;

/**
 * Strips ALL HTML tags and scripts, returning only the raw visible text.
 */
function cleanHtml(html) {
    if (!html || typeof html !== 'string') return '';

    let text = html;

    // Remove entire blocks that contain no visible text
    text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<!--[\s\S]*?-->/g, ' ');

    // Strip every remaining HTML tag
    text = text.replace(/<[^>]+>/g, ' ');

    // Decode common HTML entities
    text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');

    // Collapse whitespace and truncate
    text = text.replace(/\s+/g, ' ').trim();

    if (text.length > MAX_HTML_CHARS) {
        logger.warn(`[news-analyzer] Text truncated from ${text.length} to ${MAX_HTML_CHARS} chars`);
        text = text.substring(0, MAX_HTML_CHARS);
    }

    return text;
}

/**
 * Blueprint Generator Agent (News)
 * Recebe HTML extraído de URLs e gera 42 chaves do blueprint narrativo
 */
export class BlueprintGeneratorAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Analisa HTML e gera blueprint de 42 chaves
     * @param {Object} params
     * @param {string} params.htmlText - HTML limpo da notícia
     * @param {string} params.context - Contexto adicional do usuário
     * @returns {Promise<Object>} Blueprint com 42 chaves
     */
    async analyze({ htmlText, context }) {
        try {
            logger.info('[news-analyzer] Generating blueprint from HTML');

            // Clean and truncate HTML before it reaches the prompt to stay within
            // gpt-4o-mini's 128 K token context limit.
            const cleanedText = cleanHtml(htmlText);
            logger.info(`[news-analyzer] HTML cleaned: ${cleanedText.length} chars (original HTML: ${htmlText?.length ?? 0} chars)`);

            // Carrega prompts
            const systemPrompt = await PromptLoader.loadSystem('blueprintGenerator');
            const userPrompt = await PromptLoader.loadUser('blueprintGenerator', {
                news_html: cleanedText,
                context: context || ''
            });

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.7
            });

            // Registra tokens
            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'blueprint_generator', response);
            }

            const blueprint = JSON.parse(response.choices[0]?.message?.content);

            if (!blueprint || Object.keys(blueprint).length !== 42) {
                throw new Error(`Invalid blueprint: expected 42 keys, got ${Object.keys(blueprint).length}`);
            }

            logger.info('[news-analyzer] Blueprint generated successfully', { keys: Object.keys(blueprint).length });
            return blueprint;
        } catch (error) {
            logger.error('[news-analyzer] Failed to generate blueprint', { error: error.message });
            throw error;
        }
    }
}
