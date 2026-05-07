import { logger } from '../config/logger.js';
import { config } from '../config/env.js';

const STOP_WORDS = new Set(['a', 'an', 'and', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);
const PEOPLE_TERMS = new Set([
    'advisor',
    'analyst',
    'athlete',
    'ceo',
    'coach',
    'consultant',
    'creator',
    'designer',
    'doctor',
    'engineer',
    'entrepreneur',
    'expert',
    'founder',
    'freelancer',
    'influencer',
    'leader',
    'manager',
    'marketer',
    'mentor',
    'person',
    'people',
    'photographer',
    'portrait',
    'professional',
    'speaker',
    'student',
    'teacher',
    'team',
    'woman',
    'man',
]);

/**
 * Unsplash Service
 * Busca imagens no Unsplash baseado em keywords
 * 
 * ⚠️ UNSPLASH API COMPLIANCE:
 * - Hotlink: Usa photo.urls.* diretamente (sem proxy/download local)
 * - Download Trigger: Chama photo.links.download_location para cada foto usada
 * - Attribution: Inclui photographer_name, photographer_profile (com UTM), unsplash_link (com UTM)
 * 
 * Referência: https://help.unsplash.com/en/articles/2511245-unsplash-api-guidelines
 */
export class UnsplashService {
    constructor() {
        this.accessKey = config.unsplash.accessKey;
        this.appName = config.unsplash.appName;
        this.baseUrl = 'https://api.unsplash.com';
    }

    /**
     * Adiciona parâmetros UTM a uma URL conforme Unsplash Guidelines
     * @param {string} url - URL original
     * @returns {string} URL com UTM params
     */
    _addUtmParams(url) {
        if (!url) return null;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}utm_source=${this.appName}&utm_medium=referral`;
    }

    /**
     * Extrai dados de atribuição de uma foto do Unsplash
     * @param {Object} photo - Objeto photo retornado pela API
     * @returns {Object} Dados de atribuição formatados
     */
    _extractAttribution(photo) {
        if (!photo) return null;

        return {
            photographer_name: photo.user?.name || photo.user?.username || 'Unknown',
            photographer_profile: this._addUtmParams(photo.user?.links?.html),
            unsplash_link: this._addUtmParams(photo.links?.html),
            photo_id: photo.id,
            download_location: photo.links?.download_location || null
        };
    }

    /**
     * Trigger do download endpoint da Unsplash (obrigatório por guidelines)
     * Deve ser chamado para cada foto que é efetivamente usada no resultado final
     * @param {string} downloadLocation - URL do endpoint download_location
     * @returns {Promise<boolean>} true se sucesso, false se falha
     */
    async triggerDownload(downloadLocation) {
        if (!downloadLocation) {
            logger.warn('[unsplash] No download_location provided for trigger');
            return false;
        }

        try {
            logger.debug(`[unsplash] Triggering download: ${downloadLocation}`);

            // A URL download_location já contém todos os parâmetros necessários
            // Precisamos apenas adicionar o Client-ID para autenticação
            const url = new URL(downloadLocation);
            url.searchParams.set('client_id', this.accessKey);

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Accept-Version': 'v1'
                }
            });

            if (!response.ok) {
                // Log mais detalhado do erro
                const errorText = await response.text().catch(() => 'No error body');
                logger.warn(`[unsplash] Download trigger failed: status=${response.status}, body=${errorText.substring(0, 200)}`);
                return false;
            }

            logger.debug('[unsplash] Download triggered successfully');
            return true;
        } catch (error) {
            logger.error(`[unsplash] Failed to trigger download: ${error.message}`);
            return false;
        }
    }

    /**
     * Helper para delay
     * @param {number} ms - Milissegundos para esperar
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    _normalizeKeyword(keyword) {
        return String(keyword || '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _buildRelatedKeywordCandidates(keyword) {
        const normalized = this._normalizeKeyword(keyword);
        if (!normalized) return [];

        const words = normalized.split(' ').filter(Boolean);
        const significantWords = words.filter((word) => !STOP_WORDS.has(word));
        const baseWords = significantWords.length > 0 ? significantWords : words;
        const variants = [];

        const pushVariant = (value) => {
            const normalizedValue = this._normalizeKeyword(value);
            if (!normalizedValue || variants.includes(normalizedValue)) return;
            variants.push(normalizedValue);
        };

        pushVariant(normalized);

        if (baseWords.length >= 2) {
            pushVariant(baseWords.slice(0, 2).join(' '));
            pushVariant(baseWords.slice(-2).join(' '));
        }

        if (baseWords.length >= 3) {
            pushVariant(baseWords.slice(0, 3).join(' '));
            pushVariant(baseWords.slice(-3).join(' '));
        }

        const subject = baseWords.slice(0, Math.min(baseWords.length, 2)).join(' ');
        const hasPeopleTerm = baseWords.some((word) => PEOPLE_TERMS.has(word));

        if (subject) {
            if (hasPeopleTerm) {
                pushVariant(`${subject} portrait`);
                pushVariant(`${subject} professional`);
                pushVariant(`${subject} lifestyle`);
            } else {
                pushVariant(`${subject} concept`);
                pushVariant(`${subject} background`);
                pushVariant(`${subject} illustration`);
            }
        }

        if (baseWords.length === 1) {
            pushVariant(`${baseWords[0]} concept`);
        }

        return variants;
    }

    _collectImageCandidates(result) {
        return [
            {
                field: 'imagem_fundo',
                url: result?.imagem_fundo || null,
                attribution: result?.unsplash_attributions?.imagem_fundo || null,
            },
            {
                field: 'imagem_fundo2',
                url: result?.imagem_fundo2 || null,
                attribution: result?.unsplash_attributions?.imagem_fundo2 || null,
            },
            {
                field: 'imagem_fundo3',
                url: result?.imagem_fundo3 || null,
                attribution: result?.unsplash_attributions?.imagem_fundo3 || null,
            },
        ].filter((candidate) => Boolean(candidate.url));
    }

    _promotePrimaryImage(result, candidate, searchKeyword) {
        const normalizedSearchKeyword = this._normalizeKeyword(searchKeyword);
        if (!candidate?.url) {
            return {
                ...result,
                searchKeyword: normalizedSearchKeyword,
            };
        }

        const nextAttributions = result?.unsplash_attributions
            ? {
                ...result.unsplash_attributions,
                imagem_fundo: candidate.attribution || result.unsplash_attributions.imagem_fundo || null,
            }
            : result?.unsplash_attributions || null;

        return {
            ...result,
            imagem_fundo: candidate.url,
            unsplash_attributions: nextAttributions,
            searchKeyword: normalizedSearchKeyword,
        };
    }

    async searchImagesWithRelatedFallback(keyword, usedUrls = new Set()) {
        const variants = this._buildRelatedKeywordCandidates(keyword);
        let firstNonEmptyResult = null;

        for (const variant of variants) {
            const result = await this.searchImages(variant);
            const uniqueCandidate = this._collectImageCandidates(result).find((candidate) => !usedUrls.has(candidate.url));

            if (!firstNonEmptyResult && result?.imagem_fundo) {
                firstNonEmptyResult = result;
            }

            if (uniqueCandidate) {
                return this._promotePrimaryImage(result, uniqueCandidate, variant);
            }
        }

        if (firstNonEmptyResult?.imagem_fundo) {
            return {
                ...firstNonEmptyResult,
                imagem_fundo: null,
                searchKeyword: variants[0] || this._normalizeKeyword(keyword),
            };
        }

        return {
            imagem_fundo: null,
            imagem_fundo2: null,
            imagem_fundo3: null,
            unsplash_attributions: null,
            searchKeyword: variants[0] || this._normalizeKeyword(keyword),
        };
    }

    /**
     * Trigger downloads para múltiplas fotos com rate limiting
     * Usa delay entre requisições para evitar 403 Rate Limit Exceeded
     * @param {Array<string>} downloadLocations - Array de URLs download_location
     * @returns {Promise<Array<boolean>>} Array de resultados (true/false)
     */
    async triggerDownloads(downloadLocations) {
        if (!downloadLocations || downloadLocations.length === 0) {
            return [];
        }

        const validLocations = downloadLocations.filter(loc => loc != null);
        logger.info(`[unsplash] Triggering ${validLocations.length} downloads for compliance (sequential with delay)`);

        // Processa SEQUENCIALMENTE com delay de 200ms entre cada chamada
        // para evitar 403 Rate Limit Exceeded da Unsplash
        const results = [];
        const delayBetweenCalls = 200; // ms - aumentado para evitar rate limit

        for (let i = 0; i < validLocations.length; i++) {
            const result = await this.triggerDownload(validLocations[i]);
            results.push(result);
            
            // Delay antes da próxima chamada (se não for a última)
            if (i < validLocations.length - 1) {
                await this._delay(delayBetweenCalls);
            }
        }

        const successCount = results.filter(r => r).length;
        logger.info(`[unsplash] Download triggers completed: ${successCount}/${validLocations.length} successful`);

        return results;
    }

    /**
     * Busca imagens para um slide com dados completos de atribuição
     * @param {string} keyword - Keyword em inglês
     * @returns {Promise<Object>} Objeto com imagens e atribuições
     */
    /**
     * Busca imagens com fallback inteligente de keywords
     * Estratégia: keyword completa → keyword + portrait → palavras individuais → termos genéricos
     * @param {string} keyword - Keyword em inglês
     * @returns {Promise<Object>} Objeto com imagens e atribuições
     */
    async searchImages(keyword) {
        try {
            if (!keyword) {
                return { 
                    imagem_fundo: null, 
                    imagem_fundo2: null, 
                    imagem_fundo3: null,
                    unsplash_attributions: null
                };
            }

            // Tenta buscar com keyword completa primeiro
            let result = await this._searchImagesWithKeyword(keyword);
            
            // Se não encontrou, tenta fallbacks progressivos
            if (!result.imagem_fundo) {
                const words = keyword.split(' ').filter(w => w.trim().length > 0);

                // Fallback 1: detecta keywords de pessoas e tenta variações específicas
                const peopleTerms = ['person', 'people', 'man', 'woman', 'professional', 'entrepreneur', 'team', 'portrait', 'headshot', 'working', 'presenting'];
                const isPeopleKeyword = words.some(w => peopleTerms.includes(w.toLowerCase()));
                
                if (isPeopleKeyword) {
                    // Para keywords de pessoas, tenta com "portrait" orientation
                    logger.debug(`[unsplash] People keyword detected: "${keyword}", trying portrait orientation`);
                    result = await this._searchImagesWithKeyword(keyword, 'portrait');
                    
                    if (!result.imagem_fundo) {
                        // Tenta simplificar: "professional woman portrait" → "woman professional"
                        const simplified = words.filter(w => !['portrait', 'headshot', 'photo'].includes(w.toLowerCase())).slice(0, 2).join(' ');
                        if (simplified !== keyword) {
                            logger.debug(`[unsplash] Trying simplified people keyword: "${simplified}"`);
                            result = await this._searchImagesWithKeyword(simplified, 'portrait');
                        }
                    }
                }
                
                // Fallback 2: tenta palavras individuais
                if (!result.imagem_fundo && words.length >= 2) {
                    logger.debug(`[unsplash] No results for "${keyword}", trying first word: "${words[0]}"`);
                    result = await this._searchImagesWithKeyword(words[0]);
                    
                    if (!result.imagem_fundo) {
                        logger.debug(`[unsplash] No results for "${words[0]}", trying second word: "${words[1]}"`);
                        result = await this._searchImagesWithKeyword(words[1]);
                    }
                }
            }

            return result;
        } catch (error) {
            logger.error(`[unsplash] Failed to search images for "${keyword}":`, error.message);
            return { 
                imagem_fundo: null, 
                imagem_fundo2: null, 
                imagem_fundo3: null,
                unsplash_attributions: null
            };
        }
    }

    /**
     * Busca imagens no Unsplash para uma keyword específica
     * @param {string} keyword - Keyword em inglês
     * @param {string} orientation - Orientation: 'landscape', 'portrait', 'squarish' (default: sem filtro para máximo de resultados)
     * @returns {Promise<Object>} Objeto com imagens e atribuições
     */
    async _searchImagesWithKeyword(keyword, orientation = null) {
        try {
            logger.debug(`[unsplash] Searching images for keyword: ${keyword}${orientation ? ` (${orientation})` : ''}`);

            const params = {
                query: keyword,
                per_page: '15',
            };
            
            // Só adiciona orientation se especificado — sem filtro retorna mais resultados
            if (orientation) {
                params.orientation = orientation;
            }

            const response = await fetch(`${this.baseUrl}/search/photos?${new URLSearchParams(params)}`, {
                headers: {
                    'Accept-Version': 'v1',
                    'Authorization': `Client-ID ${this.accessKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`Unsplash API returned ${response.status}`);
            }

            const data = await response.json();
            const results = data.results || [];

            // Filtra fotos válidas
            const validPhotos = results
                .filter(r => r && r.urls && (r.urls.full || r.urls.regular))
                .slice(0, 3);

            // Extrai URLs e atribuições para cada foto
            const photosData = validPhotos.map(photo => ({
                url: photo.urls.full ?? photo.urls.regular,
                attribution: this._extractAttribution(photo)
            }));

            // Monta objeto de retorno com atribuições
            const result = {
                imagem_fundo: photosData[0]?.url ?? null,
                imagem_fundo2: photosData[1]?.url ?? null,
                imagem_fundo3: photosData[2]?.url ?? null,
                unsplash_attributions: {
                    imagem_fundo: photosData[0]?.attribution ?? null,
                    imagem_fundo2: photosData[1]?.attribution ?? null,
                    imagem_fundo3: photosData[2]?.attribution ?? null
                }
            };

            return result;
        } catch (error) {
            logger.error(`[unsplash] Failed to search images for "${keyword}": ${error.message || error}`);
            // Retorna null em caso de erro (não quebra o pipeline)
            return { 
                imagem_fundo: null, 
                imagem_fundo2: null, 
                imagem_fundo3: null,
                unsplash_attributions: null
            };
        }
    }

    /**
     * Adiciona imagens de fundo para todos os slides (em batches)
     * Processa 3 slides em paralelo com delay entre batches
     * Para slides de vídeo, usa frame extraído como imagem_fundo e vídeo processado
     * 
     * ⚠️ UNSPLASH COMPLIANCE: 
     * - Inclui atribuições completas para cada imagem
     * - Trigger de download é feito posteriormente via triggerDownloadsForSlides()
     * 
     * @param {Array} slides - Slides com keywords
     * @param {Array} extractedFrames - Frames extraídos de vídeos (com extractedVideoUrl e extractedThumbnailUrl)
     * @returns {Promise<Array>} Slides com imagens de fundo e atribuições
     */
    async addBackgroundImages(slides, extractedFrames = []) {
        logger.info(`[unsplash] Adding background images for ${slides.length} slides`);

        // Mapeia frames por posição do slide
        const framesByPosition = {};
        extractedFrames.forEach(frame => {
            if (frame.position !== undefined) {
                framesByPosition[frame.position] = {
                    videoUrl: frame.extractedVideoUrl,
                    thumbnailUrl: frame.extractedThumbnailUrl
                };
            }
        });

        const slidesWithImages = [];
        const delayBetweenSearches = 500; // 500ms entre cada busca para evitar rate limit

        // Rastreia URLs de imagem principal já usadas para garantir unicidade entre slides.
        // Pré-popula com imagens já atribuídas por fontes externas (Tavily, Google, artigo).
        const usedMainImages = new Set(
            slides
                .filter(s => s._googleImageUsed || s._tavilyImageUsed || s._articleImageUsed)
                .map(s => s.imagem_fundo)
                .filter(Boolean)
        );

        // Processa slides SEQUENCIALMENTE para evitar rate limit
        for (let i = 0; i < slides.length; i++) {
            const slide = slides[i];

            // Se tem frame extraído para essa posição, usa vídeo + thumbnail
            if (framesByPosition[i]) {
                const { videoUrl, thumbnailUrl } = framesByPosition[i];

                // Se API falhou (ambos null), busca imagem no Unsplash como fallback
                if (!videoUrl && !thumbnailUrl) {
                    logger.warn(`[unsplash] Slide ${i + 1} video extraction failed - falling back to Unsplash`);
                    const images = await this.searchImagesWithRelatedFallback(slide.keyword, usedMainImages);
                    const candidates = this._collectImageCandidates(images);
                    const mainImage = candidates.find(candidate => !usedMainImages.has(candidate.url))?.url || null;
                    if (mainImage) usedMainImages.add(mainImage);
                    slidesWithImages.push({ ...slide, ...images, imagem_fundo: mainImage });
                } else {
                    logger.debug(`[unsplash] Slide ${i + 1} is video - using extracted video`);
                    if (thumbnailUrl) usedMainImages.add(thumbnailUrl);
                    slidesWithImages.push({
                        ...slide,
                        video_url: videoUrl,
                        imagem_fundo: thumbnailUrl,
                        imagem_fundo2: null,
                        imagem_fundo3: null,
                        unsplash_attributions: null
                    });
                }
            } else {
                // Pula slides que já têm imagem do Google Images
                if (slide._googleImageUsed) {
                    logger.debug(`[unsplash] Slide ${i + 1} already has Google Image - skipping Unsplash`);
                    slidesWithImages.push(slide);
                } else if (slide._tavilyImageUsed) {
                    // Pula slides que já têm imagem da Tavily (pessoas)
                    logger.debug(`[unsplash] Slide ${i + 1} already has Tavily Image - skipping Unsplash`);
                    slidesWithImages.push(slide);
                } else if (slide._articleImageUsed) {
                    // Pula slides que já têm imagem da matéria-fonte
                    logger.debug(`[unsplash] Slide ${i + 1} already has article image - skipping Unsplash`);
                    slidesWithImages.push(slide);
                } else {
                    // Log when a slide had an entity but Tavily/Google couldn't find an image —
                    // helps diagnose why we're falling back to generic stock photos.
                    if (slide.entity_name || slide.google_keyword) {
                        logger.warn(`[unsplash] Slide ${i + 1} had entity "${slide.entity_name || slide.google_keyword}" but Tavily/Google found no image — falling back to Unsplash keyword "${slide.keyword}"`);
                    }
                    // Busca no Unsplash e seleciona a primeira imagem principal ainda não usada
                    const images = await this.searchImagesWithRelatedFallback(slide.keyword, usedMainImages);
                    const candidates = this._collectImageCandidates(images);
                    const mainImage = candidates.find(candidate => !usedMainImages.has(candidate.url))?.url || null;
                    if (mainImage) usedMainImages.add(mainImage);
                    slidesWithImages.push({ ...slide, ...images, imagem_fundo: mainImage });
                }
            }

            // Delay entre buscas (rate limiting)
            if (i < slides.length - 1) {
                await this._delay(delayBetweenSearches);
            }
        }

        logger.info(`[unsplash] Background images added successfully`);
        return slidesWithImages;
    }

    /**
     * Trigger downloads para todas as imagens Unsplash nos slides
     * Deve ser chamado APÓS finalizar a seleção de imagens, antes de persistir
     * 
     * ⚠️ UNSPLASH COMPLIANCE: Obrigatório para cada imagem usada
     * 
     * @param {Array} slides - Slides com unsplash_attributions
     * @returns {Promise<Array>} Slides atualizados com unsplash_download_triggered
     */
    async triggerDownloadsForSlides(slides) {
        const downloadLocations = [];
        const slideImageMap = []; // Mapeia download_location para slide/campo

        // Coleta todos os download_locations dos slides
        slides.forEach((slide, slideIndex) => {
            if (!slide.unsplash_attributions) return;

            ['imagem_fundo', 'imagem_fundo2', 'imagem_fundo3'].forEach(field => {
                const attr = slide.unsplash_attributions[field];
                if (attr?.download_location) {
                    downloadLocations.push(attr.download_location);
                    slideImageMap.push({ slideIndex, field });
                }
            });
        });

        if (downloadLocations.length === 0) {
            logger.info('[unsplash] No Unsplash images to trigger downloads for');
            return slides;
        }

        // Trigger todos os downloads em paralelo
        const results = await this.triggerDownloads(downloadLocations);

        // Atualiza slides com status de download
        const updatedSlides = slides.map((slide, slideIndex) => {
            if (!slide.unsplash_attributions) {
                return slide;
            }

            // Verifica se algum download deste slide foi tentado/triggered
            const slideDownloads = slideImageMap
                .filter(m => m.slideIndex === slideIndex)
                .map((m, idx) => ({
                    field: m.field,
                    triggered: results[downloadLocations.indexOf(
                        slide.unsplash_attributions[m.field]?.download_location
                    )] ?? false
                }));

            // Adiciona flag de download triggered por campo
            const downloadStatus = {};
            slideDownloads.forEach(d => {
                downloadStatus[d.field] = d.triggered;
            });

            // IMPORTANTE: unsplash_download_triggered = true se TENTOU fazer download
            // (mesmo se falhou por rate limit, a tentativa foi feita)
            const hasAnyAttr = slideDownloads.length > 0;

            return {
                ...slide,
                // true se tem imagens Unsplash (tentamos fazer download, mesmo se falhou)
                unsplash_download_triggered: hasAnyAttr,
                unsplash_download_status: downloadStatus
            };
        });

        return updatedSlides;
    }
}

export const unsplashService = new UnsplashService();
