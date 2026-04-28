import { logger } from '../config/logger.js';

// Minimum usable text length. If the direct fetch yields less than this after
// stripping tags, we assume it's a consent page / bot wall and fall back to Jina.
const MIN_CONTENT_CHARS = 300;

/**
 * HTML Scraper Service
 * Faz scraping de URLs de notícias com headers realistas.
 * Fallback automático para Jina AI Reader quando o fetch direto é bloqueado (403,
 * conteúdo vazio ou página de consentimento).
 */
export class HtmlScraperService {
    /**
     * Faz scraping de uma URL e extrai o HTML limpo
     * @param {string} url - URL da notícia
     * @returns {Promise<string>} Texto extraído
     */
    async scrape(url) {
        // 1. Try direct fetch
        try {
            logger.debug(`[html-scraper] Fetching URL: ${url}`);

            const response = await fetch(url, {
                headers: {
                    'authority': new URL(url).hostname,
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
                    'cache-control': 'no-cache',
                    'pragma': 'no-cache',
                    'sec-ch-ua': '"Google Chrome";v="134", "Chromium";v="134", "Not:A-Brand";v="24"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Linux"',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1',
                    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
                },
                signal: AbortSignal.timeout(15000),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();
            const cleanText = this._cleanHtml(html);

            if (cleanText.length >= MIN_CONTENT_CHARS) {
                logger.debug(`[html-scraper] Direct fetch OK (${cleanText.length} chars)`);
                return cleanText;
            }

            logger.warn(`[html-scraper] Direct fetch returned too little content (${cleanText.length} chars) — falling back to Jina`);
        } catch (directError) {
            logger.warn(`[html-scraper] Direct fetch failed (${directError.message}) — falling back to Jina`);
        }

        // 2. Fallback: Jina AI Reader (handles JS-rendered pages and bot walls)
        return this._scrapeViaJina(url);
    }

    /**
     * Uses Jina AI Reader (r.jina.ai) to extract clean text from a URL.
     * Works for sites that block direct scraping (G1, Folha, etc.).
     */
    async _scrapeViaJina(url) {
        const jinaUrl = `https://r.jina.ai/${url}`;
        logger.info(`[html-scraper] Trying Jina reader: ${jinaUrl}`);

        const response = await fetch(jinaUrl, {
            headers: {
                'Accept': 'text/plain',
                'X-Return-Format': 'text',
                'user-agent': 'Mozilla/5.0 (compatible; SocialSquareBot/1.0)',
            },
            signal: AbortSignal.timeout(25000),
        });

        if (!response.ok) {
            throw new Error(`Jina reader failed with HTTP ${response.status} for ${url}`);
        }

        const text = await response.text();
        const trimmed = text.trim();

        if (!trimmed || trimmed.length < MIN_CONTENT_CHARS) {
            throw new Error(`Jina returned insufficient content (${trimmed.length} chars) for ${url}`);
        }

        logger.info(`[html-scraper] Jina reader OK (${trimmed.length} chars)`);
        return trimmed;
    }

    /**
     * Faz scraping de uma URL e retorna o HTML bruto SEM limpeza.
     * Útil para extração de imagens (og:image, <img> inline) antes da limpeza.
     * @param {string} url - URL da notícia
     * @returns {Promise<string>} HTML bruto
     */
    async scrapeRaw(url) {
        try {
            const response = await fetch(url, {
                headers: {
                    'authority': new URL(url).hostname,
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'accept-language': 'en-US,en;q=0.9,pt-BR;q=0.8,pt;q=0.7',
                    'cache-control': 'no-cache',
                    'pragma': 'no-cache',
                    'sec-ch-ua': '"Google Chrome";v="134", "Chromium";v="134", "Not:A-Brand";v="24"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Linux"',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'none',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1',
                    'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
                },
                signal: AbortSignal.timeout(15000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            return await response.text();
        } catch (error) {
            logger.warn(`[html-scraper] scrapeRaw failed for ${url}: ${error.message}`);
            return '';
        }
    }

    /**
     * Limpa HTML removendo scripts, styles e tags desnecessárias
     * @param {string} html - HTML bruto
     * @returns {string} HTML limpo
     */
    _cleanHtml(html) {
        // Remove scripts
        let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

        // Remove styles
        clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

        // Remove comentários HTML
        clean = clean.replace(/<!--[\s\S]*?-->/g, '');

        // Remove tags img e a (imagens e links)
        clean = clean.replace(/<img[^>]*>/gi, '');
        clean = clean.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');

        // Remove múltiplos espaços e quebras de linha
        clean = clean.replace(/\s+/g, ' ').trim();

        return clean;
    }
}

export const htmlScraperService = new HtmlScraperService();
