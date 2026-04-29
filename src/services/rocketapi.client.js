import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Cliente RocketAPI para buscar posts do Instagram
 * Extrai URLs de imagens/vídeos dos slides do carrossel
 */
export class RocketAPIClient {
    constructor() {
        this.apiKey = config.rocketapi.key;
        this.baseUrl = 'https://v1.rocketapi.io';
    }

    /**
     * Busca post do Instagram por shortcode e extrai URLs dos slides
     * @param {string} shortcode - Código do post (ex: "DSska13Eb_d")
     * @returns {Promise<{imageUrls: string[], metadata: object}>}
     */
    async getCarouselByCode(shortcode) {
        try {
            logger.info(`Fetching Instagram post from RocketAPI: ${shortcode}`);
            logger.debug(`Using API key: ${this.apiKey ? '***' + this.apiKey.slice(-4) : 'NOT SET'}`);

            // Chamada para RocketAPI
            const response = await fetch(`${this.baseUrl}/instagram/media/get_info_by_shortcode`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ shortcode }),
            });

            logger.debug(`RocketAPI HTTP status: ${response.status}`);

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`RocketAPI error response: ${errorText}`);
                throw new Error(`RocketAPI returned ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            logger.debug(`RocketAPI response structure: ${JSON.stringify({
                hasResponse: !!data.response,
                hasBody: !!data.response?.body,
                hasItems: !!data.response?.body?.items,
                itemsLength: data.response?.body?.items?.length || 0,
                responseKeys: data.response ? Object.keys(data.response) : [],
                bodyKeys: data.response?.body ? Object.keys(data.response.body) : []
            })}`);

            const body = data.response?.body;

            if (!body?.items?.length) {
                logger.error(`Full RocketAPI response: ${JSON.stringify(data).substring(0, 500)}`);
                throw new Error(`No items found for shortcode ${shortcode}`);
            }

            // Extrai slides
            const rawSlides = [];

            for (const item of body.items) {
                if (Array.isArray(item.carousel_media) && item.carousel_media.length) {
                    // Post é carrossel - usa os slides
                    rawSlides.push(...item.carousel_media);
                } else {
                    // Post é imagem/vídeo único
                    rawSlides.push(item);
                }
            }

            // Para cada slide, extrai melhor URL (imagem ou vídeo)
            const slides = rawSlides
                .map(slide => {
                    // Melhor imagem (maior width)
                    const bestImage = slide.image_versions2?.candidates?.length
                        ? slide.image_versions2.candidates.reduce(
                            (prev, curr) => (curr.width > (prev.width || 0) ? curr : prev),
                            {},
                        )
                        : null;

                    // Melhor vídeo (maior height)
                    const bestVideo = slide.video_versions?.length
                        ? slide.video_versions.reduce(
                            (prev, curr) => (curr.height > (prev.height || 0) ? curr : prev),
                            {},
                        )
                        : null;

                    // Determina tipo e URLs
                    const isVideo = !!bestVideo; // Se tem video_versions, é vídeo (mesmo tendo thumbnail)
                    const videoUrl = bestVideo?.url || null;
                    const thumbnailUrl = bestImage?.url || null;
                    const url = thumbnailUrl || videoUrl; // Prefere thumbnail, fallback pro vídeo

                    return url ? { url, videoUrl, thumbnailUrl, isVideo } : null;
                })
                .filter(slide => !!slide);

            if (!slides.length) {
                throw new Error(`No valid image/video URLs found for shortcode ${shortcode}`);
            }

            // Separa imagens de vídeos
            const imageUrls = slides.filter(s => !s.isVideo).map(s => s.url);
            const videoCount = slides.filter(s => s.isVideo).length;

            logger.info(`Extracted ${slides.length} slides from ${shortcode} (${imageUrls.length} images, ${videoCount} videos)`);

            // Metadata adicional
            const firstItem = body.items[0];
            const postUser = firstItem.user || firstItem.caption?.user || {};
            const captionText = firstItem.caption?.text || '';

            // Extrai hashtags da legenda
            const hashtagMatches = captionText.match(/#[^\s#]+/g) || [];

            // Extrai título de áudio/música para reels
            const audioTitle = firstItem.music_metadata?.music_info?.music_asset_info?.title
                || firstItem.clips_metadata?.audio_type
                || firstItem.original_sound_info?.original_sound_title
                || null;

            const metadata = {
                shortcode,
                caption: captionText,
                like_count: firstItem.like_count || 0,
                comment_count: firstItem.comment_count || 0,
                play_count: firstItem.play_count ?? firstItem.view_count ?? null,
                product_type: firstItem.product_type || null,
                taken_at: firstItem.taken_at || null,
                location: firstItem.location?.name || null,
                audio_title: audioTitle,
                hashtags: hashtagMatches,
                media_type: firstItem.carousel_media ? 'carousel' : 'single',
                slide_count: slides.length,
                image_count: imageUrls.length,
                video_count: videoCount,
                // Dados do perfil do autor do post
                username: postUser.username || '',
                full_name: postUser.full_name || '',
                profile_pic_url: postUser.profile_pic_url || postUser.hd_profile_pic_url_info?.url || '',
                slides: slides.map((s, i) => ({
                    position: i,
                    type: s.isVideo ? 'video' : 'image',
                    url: s.url,
                    videoUrl: s.videoUrl,
                    thumbnailUrl: s.thumbnailUrl
                }))
            };

            return {
                imageUrls,
                metadata,
            };
        } catch (error) {
            logger.error(`RocketAPI error for ${shortcode}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Valida se shortcode existe
     */
    async validateCode(shortcode) {
        try {
            await this.getCarouselByCode(shortcode);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Busca perfil de um usuário do Instagram pelo username
     * @param {string} username - Username do Instagram (sem @)
     * @returns {Promise<{profile_pic_url: string, full_name: string, username: string}>}
     */
    async getUserProfile(username) {
        try {
            const cleanUsername = username.replace(/^@/, '').trim();
            logger.info(`Fetching Instagram profile for: ${cleanUsername}`);

            const response = await fetch(`${this.baseUrl}/instagram/user/get_info`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: cleanUsername }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`RocketAPI user profile error: ${response.status} - ${errorText}`);
                return null;
            }

            const data = await response.json();
            const user = data.response?.body?.user;

            if (!user) {
                logger.warn(`No user data found for username: ${cleanUsername}`);
                return null;
            }

            const profilePicUrl = user.hd_profile_pic_url_info?.url
                || user.profile_pic_url
                || user.profile_pic_url_hd
                || '';

            logger.info(`Got profile for ${cleanUsername}: pic=${profilePicUrl ? 'yes' : 'no'}`);

            return {
                profile_pic_url: profilePicUrl,
                full_name: user.full_name || '',
                username: user.username || cleanUsername,
            };
        } catch (error) {
            logger.error(`RocketAPI getUserProfile error for ${username}: ${error.message}`);
            return null;
        }
    }
}

// Export singleton
export default new RocketAPIClient();
