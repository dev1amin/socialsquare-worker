import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

const API_URL = 'https://www.googleapis.com/customsearch/v1';

class GoogleImagesService {
    constructor() {
        this.apiKey = env.googleImages?.apiKey;
        this.cx = env.googleImages?.searchEngineId;
    }

    isConfigured() {
        return !!(this.apiKey && this.cx);
    }

    /**
     * Busca imagens no Google Images via Custom Search API.
     * Retorna até 3 URLs de imagem para um keyword.
     */
    async searchImages(keyword) {
        if (!this.isConfigured()) {
            logger.warn('[google-images] API key or CX not configured, skipping');
            return null;
        }

        try {
            const params = new URLSearchParams({
                key: this.apiKey,
                cx: this.cx,
                q: keyword,
                searchType: 'image',
                num: '3',
                imgSize: 'xlarge',
                safe: 'active',
            });

            const response = await fetch(`${API_URL}?${params}`);

            if (!response.ok) {
                const errorText = await response.text();
                logger.warn(`[google-images] API error ${response.status}: ${errorText.substring(0, 200)}`);
                return null;
            }

            const data = await response.json();
            const items = data.items || [];

            if (items.length === 0) {
                logger.debug(`[google-images] No results for "${keyword}"`);
                return null;
            }

            const result = {
                imagem_fundo: items[0]?.link || '',
                imagem_fundo2: items[1]?.link || '',
                imagem_fundo3: items[2]?.link || '',
                image_source: 'google',
            };

            logger.debug(`[google-images] Found ${items.length} results for "${keyword}"`);
            return result;
        } catch (error) {
            logger.warn(`[google-images] Search failed for "${keyword}": ${error.message}`);
            return null;
        }
    }

    /**
     * Adiciona imagens do Google para slides que têm google_keyword.
     * Retorna slides com imagens preenchidas.
     * Slides sem google_keyword são retornados sem modificação.
     */
    async addGoogleImages(slides) {
        if (!this.isConfigured()) {
            return slides;
        }

        const results = [];
        for (const slide of slides) {
            if (slide.google_keyword) {
                logger.debug(`[google-images] Searching Google for: "${slide.google_keyword}"`);
                const images = await this.searchImages(slide.google_keyword);

                if (images) {
                    results.push({
                        ...slide,
                        imagem_fundo: images.imagem_fundo || slide.imagem_fundo || '',
                        imagem_fundo2: images.imagem_fundo2 || slide.imagem_fundo2 || '',
                        imagem_fundo3: images.imagem_fundo3 || slide.imagem_fundo3 || '',
                        image_source: 'google',
                        _googleImageUsed: true,
                    });
                } else {
                    results.push(slide);
                }

                // Rate limit: 100ms entre requests
                await new Promise(r => setTimeout(r, 100));
            } else {
                results.push(slide);
            }
        }

        return results;
    }
}

export const googleImagesService = new GoogleImagesService();
