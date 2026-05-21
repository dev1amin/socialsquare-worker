import { logger } from '../../../config/logger.js';
import { tavilySearch, isTavilyEnabled } from '../../../services/tavily.service.js';

const TOPIC_STOPWORDS = new Set([
    'about', 'after', 'antes', 'because', 'being', 'como', 'com', 'content', 'conteudo', 'creator', 'creators',
    'creative', 'da', 'das', 'de', 'del', 'dela', 'dele', 'do', 'dos', 'e', 'ela', 'eles', 'em', 'entre',
    'for', 'from', 'ideias', 'instagram', 'isso', 'like', 'mais', 'make', 'marketing', 'media', 'most',
    'muito', 'na', 'nas', 'nem', 'nos', 'not', 'o', 'os', 'ou', 'para', 'people', 'pela', 'pelas', 'pelo',
    'pelos', 'person', 'post', 'posts', 'porque', 'pra', 'que', 'run', 'save', 'sem', 'ser', 'social',
    'sobre', 'someone', 'stop', 'strategist', 'strategy', 'tem', 'that', 'the', 'their', 'them', 'there',
    'these', 'they', 'through', 'topics', 'uma', 'use', 'with', 'your', 'you', 'what', 'already', 'thinking',
    'audience', 'publico', 'engagement', 'engajamento', 'business', 'digital', 'online', 'viral', 'video', 'videos',
]);

function normalizeText(value = '') {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[@#]/g, ' ')
        .replace(/[^a-z0-9\s-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractTopicTerms(topic = '') {
    const uniqueTerms = [];
    for (const token of normalizeText(topic).split(' ')) {
        if (!token) continue;
        if (!/\d/.test(token) && token.length < 5) continue;
        if (TOPIC_STOPWORDS.has(token)) continue;
        if (uniqueTerms.includes(token)) continue;
        uniqueTerms.push(token);
        if (uniqueTerms.length >= 12) break;
    }
    return uniqueTerms;
}

export function buildResearchQuery(topic, businessContext = '') {
    const cleanedTopic = String(topic || '').replace(/\s+/g, ' ').trim().substring(0, 240);
    if (!cleanedTopic) return '';

    const topicTerms = extractTopicTerms(cleanedTopic);
    const cleanedBusinessContext = String(businessContext || '').replace(/\s+/g, ' ').trim().substring(0, 120);

    if (topicTerms.length >= 3 || !cleanedBusinessContext) {
        return cleanedTopic;
    }

    return `${cleanedTopic} ${cleanedBusinessContext}`.trim();
}

export function filterResearchSourcesByTopic(sources = [], topic = '') {
    if (!Array.isArray(sources) || sources.length === 0) {
        return [];
    }

    const topicTerms = extractTopicTerms(topic);
    if (topicTerms.length === 0) {
        return sources.slice(0, 5);
    }

    const minLooseMatches = topicTerms.length >= 6 ? 2 : 1;

    return sources
        .map((source) => {
            const haystack = normalizeText(`${source?.title || ''}\n${source?.content || ''}`);
            const matches = topicTerms.filter((term) => haystack.includes(term));
            const strongMatches = matches.filter((term) => /\d/.test(term) || term.length >= 7);
            const sourceScore = Number(source?.score) || 0;

            return {
                source,
                matches,
                strongMatches,
                relevanceScore: strongMatches.length * 3 + matches.length + sourceScore,
            };
        })
        .filter(({ matches, strongMatches }) => strongMatches.length >= 1 || matches.length >= minLooseMatches)
        .sort((left, right) => right.relevanceScore - left.relevanceScore)
        .slice(0, 5)
        .map(({ source }) => source);
}

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

        const query = buildResearchQuery(topic, businessContext);

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

        const filteredSources = filterResearchSourcesByTopic(res.sources || [], topic);
        if (filteredSources.length === 0) {
            logger.info(`[${this.traceId}] ResearchAgent: descartando pesquisa sem fontes alinhadas ao tema`);
            return null;
        }

        const summary = this._buildSummary(filteredSources);
        logger.info(`[${this.traceId}] ResearchAgent: ${filteredSources.length}/${res.sources.length} fontes alinhadas em ${Date.now() - t0}ms`);
        return {
            summary,
            sources: filteredSources,
            provider: 'tavily',
        };
    }

    _buildSummary(sources = []) {
        const lines = [];
        if (sources.length) {
            lines.push('Trechos da pesquisa filtrada:');
            sources.slice(0, 5).forEach((source, index) => {
                const snippet = (source.content || '').substring(0, 380).replace(/\s+/g, ' ').trim();
                lines.push(`\n[${index + 1}] ${source.title} (${source.url})\n"${snippet}"`);
            });
        }
        return lines.join('\n');
    }
}
