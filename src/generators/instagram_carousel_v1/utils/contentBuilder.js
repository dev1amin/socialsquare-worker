/**
 * Content Builder Utilities
 * Helpers para construir textos combinados de múltiplas fontes para geração de carrosséis
 * 
 * Suporta:
 * - content.text (texto combinado do orchestrator)
 * - content.caption (caption do Instagram)
 * - content.allCaptions (todas as captions de múltiplos posts)
 * - input.additionalTexts (textos extraídos de URLs adicionais pela API)
 * - input.allCaptions (todas as captions de múltiplos posts)
 * - input.context (instruções do usuário)
 */

/**
 * Constrói o texto original combinando todas as fontes disponíveis
 * @param {Object} content - Objeto de conteúdo do orchestrator
 * @param {Object} input - Input do job com additionalTexts e context
 * @returns {string} Texto combinado de todas as fontes
 */
export function buildOriginalText(content, input) {
    // Prioridade 1: Se já tiver texto combinado do orchestrator, usa ele
    if (content.text && content.text.trim()) {
        return content.text;
    }
    
    // Prioridade 2: Montar manualmente a partir das fontes
    const parts = [];
    
    // Fonte: Captions do Instagram (verifica se tem múltiplas)
    const allCaptions = content.allCaptions || input.allCaptions || [];
    
    if (Array.isArray(allCaptions) && allCaptions.length > 1) {
        // Múltiplos posts do Instagram
        allCaptions.forEach((caption, idx) => {
            if (caption && caption.trim()) {
                parts.push(`[FONTE INSTAGRAM ${idx + 1}]\n${caption}`);
            }
        });
    } else if (content.caption && content.caption.trim()) {
        // Apenas um post do Instagram
        parts.push(`[CONTEÚDO PRINCIPAL - INSTAGRAM]\n${content.caption}`);
    }
    
    // Fonte: Textos adicionais - verifica em múltiplos lugares
    // Pode estar em content.additionalTexts, input.additionalTexts ou input.additional_texts
    const additionalTexts = content.additionalTexts || input.additionalTexts || input.additional_texts || [];
    
    if (Array.isArray(additionalTexts) && additionalTexts.length > 0) {
        additionalTexts.forEach((text, idx) => {
            if (text && text.trim()) {
                parts.push(`[FONTE ADICIONAL ${idx + 1} - NOTÍCIA/ARTIGO]\n${text}`);
            }
        });
    }
    
    // Se tiver partes, junta com separador
    if (parts.length > 0) {
        return parts.join('\n\n---\n\n');
    }
    
    // Fallback: JSON do content
    return JSON.stringify(content);
}

/**
 * Constrói o texto de contexto enriquecido com instruções para múltiplas fontes
 * @param {Object} input - Input do job com context e additionalTexts
 * @returns {string} Contexto enriquecido
 */
export function buildContextText(input) {
    let contextText = input.context || '';
    
    // Verifica additionalTexts em múltiplos lugares
    const additionalTexts = input.additionalTexts || input.additional_texts || [];
    const hasAdditionalTexts = Array.isArray(additionalTexts) && additionalTexts.length > 0;
    
    // Verifica se tem múltiplos posts do Instagram
    const allCaptions = input.allCaptions || [];
    const hasMultipleInstagramPosts = Array.isArray(allCaptions) && allCaptions.length > 1;
    
    // Se tiver múltiplas fontes (multifont ou múltiplos posts), adiciona instrução especial
    if ((hasAdditionalTexts || hasMultipleInstagramPosts) && input.multifont) {
        const sourcesList = [];
        
        if (hasMultipleInstagramPosts) {
            sourcesList.push(`- ${allCaptions.length} posts do Instagram`);
        } else {
            sourcesList.push(`- Conteúdo principal (Instagram)`);
        }
        
        if (hasAdditionalTexts) {
            sourcesList.push(`- ${additionalTexts.length} fonte(s) adicional(is) (notícias/artigos)`);
        }
        
        const instruction = `

━━━━━━━━━━━━━━━━━━━━━━
INSTRUÇÃO IMPORTANTE: MÚLTIPLAS FONTES
━━━━━━━━━━━━━━━━━━━━━━

Este carrossel deve OBRIGATORIAMENTE incorporar informações de TODAS as fontes fornecidas:
${sourcesList.join('\n')}

Certifique-se de:
1. Incluir os pontos principais de CADA fonte
2. Integrar as informações de forma coesa e narrativa
3. Não ignorar nenhuma fonte fornecida
4. Dar destaque especial ao que o usuário solicitou no contexto`;
        
        contextText = contextText + instruction;
    }
    
    return contextText;
}

/**
 * Verifica se o input tem múltiplas fontes de conteúdo
 * @param {Object} input - Input do job
 * @returns {boolean} True se tiver múltiplas fontes
 */
export function hasMultipleSources(input) {
    return input.multifont === true || 
           (input.additionalTexts && input.additionalTexts.length > 0);
}
