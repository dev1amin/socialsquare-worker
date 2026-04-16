import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Brand Adapter Agent: adapta slides ao posicionamento e tom de voz da marca
 * Mantém estrutura e tamanho, apenas ajusta linguagem
 */
export class BrandAdapterAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async adapt({ slides, brandData, context }) {
        try {
            // Envia apenas title/subtitle ao GPT (campos de texto)
            const textOnly = slides.map(s => {
                const obj = { title: s.title };
                if (s.subtitle !== undefined && s.subtitle !== null) obj.subtitle = s.subtitle;
                return obj;
            });

            const { system, user } = await PromptLoader.loadBoth('brandAdapter', {
                slides_json: JSON.stringify(textOnly),
                brand_positioning: brandData?.brand_positioning || 'N/A',
                voice_tone: brandData?.voice_tone || 'profissional e amigável',
                target_audience: brandData?.target_audience || 'público geral',
                forbidden_words: brandData?.forbidden_words || 'N/A',
                preferred_words: brandData?.preferred_words || 'N/A',
                forbidden_topics: brandData?.forbidden_topics || 'N/A',
                objective: brandData?.objective || 'engajamento',
                context: context || 'N/A',
            });

            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.5,
                frequency_penalty: 0.2,
                presence_penalty: 0.1,
                top_p: 0.9,
            });

            // Registra tokens
            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'brand_adapter', completion);
            }

            const result = JSON.parse(completion.choices[0].message.content);
            const adaptedText = result.slides || [];
            logger.debug(`Adapted ${adaptedText.length} slides to brand voice`);

            // Mergeia texto adaptado de volta nos slides originais (preserva imagens, keywords, attributions)
            return slides.map((original, i) => {
                const adapted = adaptedText[i];
                if (!adapted) return original;
                return {
                    ...original,
                    title: adapted.title || original.title,
                    subtitle: adapted.subtitle !== undefined ? adapted.subtitle : original.subtitle,
                };
            });
        } catch (error) {
            const err = new Error(`Brand adaptation failed: ${error.message}`);
            err.stage = 'brand_adapter';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
