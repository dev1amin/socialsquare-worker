import { logger } from '../config/logger.js';

/**
 * HTML Scraper Service
 * Faz scraping de URLs de notícias com headers realistas
 */
export class HtmlScraperService {
    /**
     * Faz scraping de uma URL e extrai o HTML limpo
     * @param {string} url - URL da notícia
     * @returns {Promise<string>} HTML extraído e limpo
     */
    async scrape(url) {
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
                timeout: 15000
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const html = await response.text();

            // Extrai conteúdo limpo (remove scripts, styles, etc)
            const cleanHtml = this._cleanHtml(html);

            logger.debug(`[html-scraper] HTML fetched successfully (${cleanHtml.length} chars)`);
            return cleanHtml;
        } catch (error) {
            logger.error(`[html-scraper] Failed to scrape ${url}:`, error.message);
            throw new Error(`Failed to scrape URL: ${error.message}`);
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
