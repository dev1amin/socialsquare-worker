import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Blueprint Generator Agent
 * Recebe resultado da análise de imagens (OCR + descrição visual) e gera 42 chaves do blueprint narrativo
 * NOVO: Suporta múltiplas fontes de conteúdo (multifont) via additionalTexts e combinedSources
 */
export class BlueprintGeneratorAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Analisa conteúdo e gera blueprint de 42 chaves
     * @param {Object} params
     * @param {Array} params.imageAnalysis - Resultado do ImageAnalyzerAgent
     * @param {string} params.context - Contexto adicional do usuário
     * @param {Array} params.additionalTexts - Textos adicionais extraídos de URLs
     * @param {Array} params.combinedSources - Todas as fontes combinadas
     * @param {boolean} params.multifont - Flag indicando múltiplas fontes
     * @returns {Promise<Object>} Blueprint com 42 chaves
     */
    async analyze({ imageAnalysis, context, additionalTexts = [], combinedSources = [], sources = [], multifont = false }) {
        try {
            logger.info('[analyzer] Generating blueprint from image analysis', {
                hasContext: !!context,
                additionalTextsCount: additionalTexts.length,
                combinedSourcesCount: combinedSources.length,
                multifont
            });

            // Carrega prompts (métodos static)
            const systemPrompt = await PromptLoader.loadSystem('blueprintGenerator');
            
            // NOVO: Monta conteúdo enriquecido com textos adicionais
            let enrichedContent = JSON.stringify(imageAnalysis);
            
            // Se tiver textos adicionais, adiciona ao prompt
            if (additionalTexts.length > 0 || combinedSources.length > 0 || context) {
                const additionalInfo = [];
                
                // Adiciona contexto do usuário
                if (context) {
                    additionalInfo.push(`\n\n=== CONTEXTO/INSTRUÇÕES DO USUÁRIO ===\n${context}`);
                }
                
                // Adiciona textos de fontes adicionais
                if (additionalTexts.length > 0) {
                    additionalInfo.push(`\n\n=== CONTEÚDOS ADICIONAIS (para incorporar no carrossel) ===`);
                    additionalTexts.forEach((text, idx) => {
                        if (text && text.trim()) {
                            additionalInfo.push(`\n--- FONTE ADICIONAL ${idx + 1} ---\n${text.substring(0, 3000)}${text.length > 3000 ? '...(truncado)' : ''}`);
                        }
                    });
                }
                
                // Log para debug
                if (additionalTexts.length > 0) {
                    logger.info(`[analyzer] Including ${additionalTexts.length} additional texts in blueprint generation`);
                }
                
                enrichedContent += additionalInfo.join('\n');
            }
            
            const userPrompt = await PromptLoader.loadUser('blueprintGenerator', {
                content_slides: enrichedContent
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

            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'blueprint_generator', response);
            }

            const blueprint = JSON.parse(response.choices[0]?.message?.content);

            if (!blueprint || Object.keys(blueprint).length !== 42) {
                throw new Error(`Invalid blueprint: expected 42 keys, got ${Object.keys(blueprint).length}`);
            }

            logger.info('[analyzer] Blueprint generated successfully', { keys: Object.keys(blueprint).length });
            return blueprint;
        } catch (error) {
            logger.error('[analyzer] Failed to generate blueprint', { error: error.message });
            throw error;
        }
    }
}
