import { logger } from '../../../config/logger.js';
import { tavilySearch, isTavilyEnabled } from '../../../services/tavily.service.js';

/**
 * ResearchAgent
 *
 * Pesquisa prévia com fontes confiáveis, para reduzir alucinação
 * do blueprint generator. Best-effort: se Tavily não estiver configurado
 * ou falhar, retorna null e o pipeline segue sem research.
 *
 * Resultado:
 *   {
 *     summary: string,      // texto curto pronto pra injetar em prompt
 *     sources: [{ title, url, content, score, publishedDate }],
 *     provider: 'tavily' | 'none',
 *   }
 */
export class ResearchAgent {
    constructor(traceId) {
        this.traceId = traceId || 'research';
    }

    /**
     * @param {Object} p
     * @param {string} p.topic
     * @param {string} [p.businessContext]
     * @param {number} [p.maxResults=5]
     */
    async run({ topic, businessContext, maxResults = 5 }) {
        if (!topic || !topic.trim()) {
            return null;
        }
        if (!isTavilyEnabled()) {
            logger.info(`[${this.traceId}] ResearchAgent: TAVILY_API_KEY ausente — pulando`);
            return null;
        }

        let query = topic.trim();
        if (businessContext && businessContext.trim()) {
            query = `${query} — contexto: ${businessContext.trim().substring(0, 120)}`;
        }

        logger.info(`[${this.traceId}] ResearchAgent: pesquisando "${query.substring(0, 100)}"...`);
        const t0 = Date.now();
        let res;
        try {
            res = await tavilySearch(query, { maxResults });
        } catch (err) {
            logger.warn(`[${this.traceId}] ResearchAgent: falha — ${err.message}`);
            return null;
        }
        if (!res || (!res.sources?.length && !res.answer)) {
            logger.info(`[${this.traceId}] ResearchAgent: sem resultados`);
            return null;
        }

        const summary = this._buildSummary(res);
        logger.info(`[${this.traceId}] ResearchAgent: ${res.sources.length} fontes em ${Date.now() - t0}ms`);
        return {
            summary,
            sources: res.sources,
            provider: 'tavily',
        };
    }

    _buildSummary(res) {
        const lines = [];
        if (res.answer) {
            lines.push(`Resumo da pesquisa:\n${res.answer.trim()}`);
        }
        if (res.sources?.length) {
            lines.push('\nTrechos das fontes:');
            res.sources.slice(0, 5).forEach((s, i) => {
                const snippet = (s.content || '').substring(0, 380).replace(/\s+/g, ' ').trim();
                lines.push(`\n[${i + 1}] ${s.title} (${s.url})\n"${snippet}"`);
            });
        }
        return lines.join('\n');
    }
}
