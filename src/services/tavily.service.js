/**
 * Tavily Search API wrapper (worker).
 *
 * Duplica mínimo a lógica do backend (backend/src/shared/services/tavily.service.js)
 * porque workers e backend são projetos separados.
 */

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 15000;

export async function tavilySearch(query, opts = {}) {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) return null;
    if (!query || !query.trim()) return null;

    const {
        maxResults = 5,
        searchDepth = 'basic',
        includeAnswer = true,
        timeoutMs = DEFAULT_TIMEOUT_MS,
    } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(TAVILY_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: apiKey,
                query: query.trim(),
                search_depth: searchDepth,
                include_answer: includeAnswer,
                max_results: Math.min(Math.max(maxResults, 1), 10),
                topic: 'general',
            }),
            signal: controller.signal,
        });
        if (!res.ok) return null;
        const data = await res.json();
        const sources = Array.isArray(data.results)
            ? data.results.map((r) => ({
                title: String(r.title || '').trim(),
                url: String(r.url || '').trim(),
                content: String(r.content || '').trim().substring(0, 1200),
                score: typeof r.score === 'number' ? r.score : 0,
                publishedDate: r.published_date || undefined,
            }))
            : [];
        return {
            answer: typeof data.answer === 'string' ? data.answer : '',
            sources,
        };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export function isTavilyEnabled() {
    return Boolean(process.env.TAVILY_API_KEY);
}
