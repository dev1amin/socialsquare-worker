import { logger } from '../config/logger.js';

/**
 * TokenTracker: rastreia tokens de entrada/saída por agente/generator
 * Coleta dados de cada chamada OpenAI e monta um relatório consolidado
 */
export class TokenTracker {
    constructor(jobId) {
        this.jobId = jobId;
        this.agents = {}; // { agent_name: { input: X, output: Y, total: Z } }
        this.totalInput = 0;
        this.totalOutput = 0;
    }

    /**
     * Registra tokens de um agente específico
     * @param {string} agentName - Nome do agente (ex: 'blueprint_generator', 'case_generator')
     * @param {number} inputTokens - Tokens de entrada (prompt)
     * @param {number} outputTokens - Tokens de saída (resposta)
     */
    addTokens(agentName, inputTokens, outputTokens) {
        if (!agentName || !Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)) {
            logger.warn(`[TokenTracker] Invalid token registration: agent=${agentName}, input=${inputTokens}, output=${outputTokens}`);
            return;
        }

        const total = inputTokens + outputTokens;

        if (!this.agents[agentName]) {
            this.agents[agentName] = { input: 0, output: 0, total: 0 };
        }

        this.agents[agentName].input += inputTokens;
        this.agents[agentName].output += outputTokens;
        this.agents[agentName].total += total;

        this.totalInput += inputTokens;
        this.totalOutput += outputTokens;

        logger.debug(`[TokenTracker] Job ${this.jobId} - ${agentName}: +${inputTokens} input, +${outputTokens} output`);
    }

    /**
     * Retorna o objeto formatado para salvar no banco
     */
    getMetrics() {
        return {
            tokens_input: this.totalInput,
            tokens_output: this.totalOutput,
            tokens_total: this.totalInput + this.totalOutput,
            tokens_by_agent: this.agents,
        };
    }

    /**
     * Retorna resumo para logging
     */
    getSummary() {
        const agentCount = Object.keys(this.agents).length;
        const total = this.totalInput + this.totalOutput;
        return `${agentCount} agents, ${this.totalInput} input tokens, ${this.totalOutput} output tokens, ${total} total`;
    }

    /**
     * Log resumido dos tokens ao final do job
     */
    logSummary() {
        logger.info(`[TokenTracker] Job ${this.jobId} tokens: ${this.getSummary()}`);
        Object.entries(this.agents).forEach(([agentName, tokens]) => {
            logger.debug(`  - ${agentName}: ${tokens.input} input + ${tokens.output} output = ${tokens.total} total`);
        });
    }
}

// Export singleton wrapper para facilitar uso
export const createTokenTracker = (jobId) => new TokenTracker(jobId);
