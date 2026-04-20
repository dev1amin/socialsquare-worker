
import { logger } from '../config/logger.js';

/**
 * Service para extrair frames de vídeos do Instagram
 * Chama API que gera thumbnail estilizado do vídeo
 */
class VideoFrameExtractorService {
    constructor() {
        this.apiUrl = process.env.VIDEO_EXTRACT_API_URL || 'http://apivftomc_template_raid-evolvingai:8000/extract-video';

        // Parâmetros fixos
        this.fixedParams = {
            description: 'bla',
            profileImageUrl: 'https://i.postimg.cc/CLJZBvtD/logoo-2.png',
            accountName: 'Workez AI',
            instagramHandle: 'workez.ai',
            baseBackgroundColor: '010b1b'
        };
    }

    /**
     * Extrai frame de um vídeo
     * @param {Object} videoData - Dados do vídeo
     * @param {string} videoData.videoUrl - URL do vídeo
     * @param {string} videoData.thumbnailUrl - URL da thumbnail (fallback)
     * @returns {Promise<{videoUrl: string|null, thumbnailUrl: string|null}>}
     */
    async extractFrame({ videoUrl, thumbnailUrl }) {
        try {
            logger.info(`🎬 Extracting frame from video...`);
            logger.debug(`Video URL: ${videoUrl}`);
            logger.debug(`Thumbnail URL: ${thumbnailUrl}`);
            logger.debug(`API URL: ${this.apiUrl}`);

            const requestBody = {
                videoUrl,
                thumbnailUrl,
                ...this.fixedParams
            };

            logger.debug(`Request body: ${JSON.stringify(requestBody)}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 segundos (1:30)

            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            logger.debug(`API response status: ${response.status}`);

            // Se API retornou erro, loga e retorna null
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unable to read error');
                logger.error(`⚠️  Frame extraction failed (${response.status}): ${errorText}`);
                return { videoUrl: null, thumbnailUrl: null };
            }

            const data = await response.json();
            logger.debug(`API response data: ${JSON.stringify(data)}`);

            // API retorna array: [{ url: "video.mp4", thumbnail_url: "thumb.jpg", ... }]
            const result = Array.isArray(data) ? data[0] : data;
            const extractedVideoUrl = result?.url;
            const extractedThumbnailUrl = result?.thumbnail_url;

            if (!extractedVideoUrl && !extractedThumbnailUrl) {
                logger.warn(`⚠️  No URLs in API response`);
                return { videoUrl: null, thumbnailUrl: null };
            }

            logger.info(`✓ Frame extracted successfully`);
            logger.debug(`Extracted video: ${extractedVideoUrl}`);
            logger.debug(`Extracted thumb: ${extractedThumbnailUrl}`);

            return {
                videoUrl: extractedVideoUrl,
                thumbnailUrl: extractedThumbnailUrl
            };

        } catch (error) {
            const errorMsg = error.name === 'AbortError' ? 'Request timeout (90s)' : error.message;
            logger.error(`✗ Error extracting frame: ${errorMsg}`);
            logger.debug(`Error stack: ${error.stack}`);
            return { videoUrl: null, thumbnailUrl: null };
        }
    }

    /**
     * Extrai frames de múltiplos vídeos em paralelo
     * @param {Array<Object>} videoSlides - Array de slides com vídeos
     * @returns {Promise<Array<Object>>} Array de slides com videoUrl e thumbnailUrl extraídos
     */
    async extractFrames(videoSlides) {
        if (!videoSlides || videoSlides.length === 0) {
            return [];
        }

        logger.info(`🎬 Extracting frames from ${videoSlides.length} videos`);

        const promises = videoSlides.map(async (slide) => {
            const extracted = await this.extractFrame({
                videoUrl: slide.videoUrl,
                thumbnailUrl: slide.thumbnailUrl || slide.url
            });

            return {
                ...slide,
                extractedVideoUrl: extracted.videoUrl,
                extractedThumbnailUrl: extracted.thumbnailUrl
            };
        });

        const results = await Promise.all(promises);

        logger.info(`✓ Extracted ${results.length} frames`);
        return results;
    }
}

export const videoFrameExtractorService = new VideoFrameExtractorService();
