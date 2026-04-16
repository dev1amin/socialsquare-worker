import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Image Analyzer Agent
 * Realiza OCR + descrição visual de slides de carrossel do Instagram
 * Usa GPT-4O Vision para extrair texto e descrever conteúdo visual
 */
export class ImageAnalyzerAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Analisa imagens do carrossel
     * @param {Object} params
     * @param {Array<string>} params.imageUrls - URLs das imagens (ou base64)
     * @param {Object} params.metadata - Metadata do post (incluindo frames extraídos de vídeos)
     * @returns {Promise<Array>} Array de { slide: number, texto: string, descrição: string }
     */
    async analyze({ imageUrls, metadata = {} }) {
        try {
            // Valida se tem imagens para analisar
            if (!imageUrls || imageUrls.length === 0) {
                logger.warn('[image-analyzer] No images to analyze');
                throw new Error('No images to analyze');
            }

            logger.info('[image-analyzer] Starting image analysis', {
                count: imageUrls.length,
                total_slides: metadata.slide_count || imageUrls.length,
                video_count: metadata.video_count || 0,
                extracted_frames: metadata.extractedFrames?.length || 0
            });

            // Baixa imagens e converte para base64
            const base64Images = await this._downloadAndConvertToBase64(imageUrls);

            logger.debug(`[image-analyzer] Converted ${base64Images.length} images to base64`);

            // Carrega prompts do arquivo
            const systemPrompt = await PromptLoader.loadSystem('imageAnalyzer');
            const userPrompt = await PromptLoader.loadUser('imageAnalyzer', {
                image_count: imageUrls.length
            });

            // Monta array de mensagens com as imagens em base64
            const imageMessages = base64Images.map(base64 => ({
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${base64}`,
                    detail: 'low' // Usa low detail para economizar tokens
                }
            }));

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'text',
                                text: userPrompt
                            },
                            ...imageMessages
                        ]
                    }
                ],
                max_tokens: 2500,
                temperature: 0.3
            });

            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'image_analyzer', response);
            }

            const rawOutput = response.choices[0]?.message?.content?.trim();

            if (!rawOutput) {
                throw new Error('Empty response from GPT-4O Vision');
            }

            // Parse do formato customizado retornado
            const parsedSlides = this.parseSlideOutput(rawOutput);

            logger.info('[image-analyzer] Image analysis completed', {
                slides_analyzed: parsedSlides.length
            });

            return parsedSlides;
        } catch (error) {
            logger.error('[image-analyzer] Failed to analyze images', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Parse do formato customizado slide1{texto: "...", descrição: "..."}
     * @param {string} rawOutput - Output cru do GPT
     * @returns {Array} Array de objetos { slide: number, texto: string, descrição: string }
     */
    parseSlideOutput(rawOutput) {
        const slides = [];

        // Log do output para debug
        logger.debug(`[image-analyzer] Raw output length: ${rawOutput.length}`);
        logger.debug(`[image-analyzer] Raw output preview: ${rawOutput.substring(0, 500)}...`);

        // Regex para capturar cada bloco slide (formato original)
        const slideRegex = /slide(\d+)\s*\{[^}]*texto:\s*"""([^"]*)""",?\s*descrição:\s*"([^"]*)"\s*\}/gs;

        let match;
        while ((match = slideRegex.exec(rawOutput)) !== null) {
            slides.push({
                slide: parseInt(match[1]),
                texto: match[2].trim(),
                descrição: match[3].trim()
            });
        }

        if (slides.length > 0) {
            logger.debug(`[image-analyzer] Parsed ${slides.length} slides with regex`);
            return slides;
        }

        // Fallback 1: Tenta regex alternativa (aspas simples ou duplas normais)
        const altRegex = /slide\s*(\d+)\s*[:\{]\s*(?:texto|text)\s*[:=]\s*["'`]([^"'`]*)["'`]\s*,?\s*(?:descrição|descricao|description)\s*[:=]\s*["'`]([^"'`]*)["'`]/gi;
        
        while ((match = altRegex.exec(rawOutput)) !== null) {
            slides.push({
                slide: parseInt(match[1]),
                texto: match[2].trim(),
                descrição: match[3].trim()
            });
        }

        if (slides.length > 0) {
            logger.debug(`[image-analyzer] Parsed ${slides.length} slides with alt regex`);
            return slides;
        }

        // Fallback 2: Tenta JSON
        try {
            // Remove marcadores de código se existir
            let cleaned = rawOutput.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();

            // Tenta parse direto
            const parsed = JSON.parse(cleaned);

            if (Array.isArray(parsed)) {
                logger.debug(`[image-analyzer] Parsed ${parsed.length} slides as JSON array`);
                return parsed.map((item, idx) => ({
                    slide: item.slide || idx + 1,
                    texto: item.texto || item.text || '',
                    descrição: item.descrição || item.descricao || item.description || ''
                }));
            }

            // Se é objeto com slides
            if (parsed.slides && Array.isArray(parsed.slides)) {
                logger.debug(`[image-analyzer] Parsed ${parsed.slides.length} slides from JSON object`);
                return parsed.slides.map((item, idx) => ({
                    slide: item.slide || idx + 1,
                    texto: item.texto || item.text || '',
                    descrição: item.descrição || item.descricao || item.description || ''
                }));
            }
        } catch (e) {
            logger.debug('[image-analyzer] JSON parse failed, trying more fallbacks');
        }

        // Fallback 3: Regex bem flexível para extrair qualquer padrão de slide
        const flexRegex = /(?:slide|imagem|image)\s*#?\s*(\d+)[:\s]*(?:[\n\r]+)?.*?(?:texto|text|ocr)[:\s]*["'`]?([^"'\n`]*?)["'`]?\s*(?:[\n\r,]+).*?(?:descrição|descricao|description|desc)[:\s]*["'`]?([^"'\n`]*?)["'`]?\s*(?:[\n\r,}]|$)/gi;

        while ((match = flexRegex.exec(rawOutput)) !== null) {
            if (match[2] || match[3]) {  // Só adiciona se tiver algum conteúdo
                slides.push({
                    slide: parseInt(match[1]),
                    texto: (match[2] || '').trim(),
                    descrição: (match[3] || '').trim()
                });
            }
        }

        if (slides.length > 0) {
            logger.debug(`[image-analyzer] Parsed ${slides.length} slides with flex regex`);
            return slides;
        }

        // Fallback 4: Se nada funcionar, cria slides vazios baseado no número de imagens mencionadas
        const slideNumbers = rawOutput.match(/(?:slide|imagem|image)\s*#?\s*(\d+)/gi);
        if (slideNumbers && slideNumbers.length > 0) {
            const maxSlide = Math.max(...slideNumbers.map(s => parseInt(s.match(/\d+/)[0])));
            logger.warn(`[image-analyzer] Creating ${maxSlide} empty slides as last resort`);
            
            for (let i = 1; i <= maxSlide; i++) {
                slides.push({
                    slide: i,
                    texto: '',
                    descrição: `Slide ${i} - análise indisponível`
                });
            }
            return slides;
        }

        // Fallback 5: Último recurso - retorna um slide genérico para não quebrar o pipeline
        logger.warn('[image-analyzer] All parsing methods failed, returning generic fallback');
        return [{
            slide: 1,
            texto: '',
            descrição: 'Análise de imagem não disponível - conteúdo visual detectado'
        }];
    }

    /**
     * Baixa imagens e converte para base64 (paralelo)
     * @param {Array<string>} urls - URLs das imagens
     * @returns {Promise<Array<string>>} Array de base64 strings
     */
    async _downloadAndConvertToBase64(urls) {
        logger.debug(`[image-analyzer] Downloading ${urls.length} images in parallel...`);

        // Faz download de todas em paralelo
        const downloadPromises = urls.map((url, i) =>
            this._downloadSingleImage(url, i + 1, urls.length)
        );

        const base64Images = await Promise.all(downloadPromises);
        return base64Images;
    }

    /**
     * Baixa uma única imagem e converte para base64
     * @param {string} url - URL da imagem
     * @param {number} index - Índice (para logging)
     * @param {number} total - Total de imagens (para logging)
     * @returns {Promise<string>} Base64 string
     */
    async _downloadSingleImage(url, index, total) {
        try {
            logger.debug(`[image-analyzer] Downloading image ${index}/${total}`);

            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'image/*',
                },
                timeout: 15000
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64 = buffer.toString('base64');

            logger.debug(`[image-analyzer] Image ${index}/${total} downloaded (${(buffer.length / 1024).toFixed(2)} KB)`);
            return base64;
        } catch (error) {
            logger.error(`[image-analyzer] Failed to download image ${index}/${total}:`, error.message);
            throw new Error(`Failed to download image ${index}: ${error.message}`);
        }
    }
}
