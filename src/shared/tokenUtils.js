/**
 * Extrai tokens de uma resposta da OpenAI
 * @param {object} completion - Resposta do OpenAI API
 * @returns {object} { input: number, output: number }
 */
export const extractTokensFromCompletion = (completion) => {
    if (!completion?.usage) {
        return { input: 0, output: 0 };
    }

    return {
        input: completion.usage.prompt_tokens || 0,
        output: completion.usage.completion_tokens || 0,
    };
};

/**
 * Helper para registrar tokens de uma chamada OpenAI
 * @param {TokenTracker} tokenTracker - Instância do TokenTracker
 * @param {string} agentName - Nome do agente
 * @param {object} completion - Resposta do OpenAI
 */
export const recordTokens = (tokenTracker, agentName, completion) => {
    if (!tokenTracker) return;

    const { input, output } = extractTokensFromCompletion(completion);
    tokenTracker.addTokens(agentName, input, output);
};
