import { openai } from '../../../config/openai.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

const IMAGE_DOWNLOAD_TIMEOUT_MS = 15000;
const IMAGE_DOWNLOAD_ATTEMPTS = 3;
const IMAGE_DOWNLOAD_CONCURRENCY = 3;
const RETRYABLE_IMAGE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DESCRIPTION_FIELD_PATTERN = String.raw`(?:descri(?:\u00e7\u00e3o|cao)|description|desc)`;
const DEFAULT_SLIDE_TEXT = '(sem texto no slide)';
const VISUAL_ANALYSIS_AVAILABLE = 'An\u00e1lise visual dispon\u00edvel';
const VISUAL_ANALYSIS_UNAVAILABLE = 'An\u00e1lise visual indispon\u00edvel';
const GENERIC_VISUAL_FALLBACK = 'An\u00e1lise de imagem n\u00e3o dispon\u00edvel - conte\u00fado visual detectado';

/**
 * Image Analyzer Agent
 * Performs OCR + visual description for Instagram carousel slides.
 * Uses GPT-4O Vision to extract text and describe visual content.
 */
export class ImageAnalyzerAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    /**
     * Analyze carousel images.
     * @param {Object} params
     * @param {Array<string>} params.imageUrls
     * @param {Object} params.metadata
     * @returns {Promise<Array>}
     */
    async analyze({ imageUrls = [], metadata = {} }) {
        try {
            const downloadTargets = this._buildDownloadTargets(imageUrls, metadata);
            const fallbackSlideCount = downloadTargets.length || this._inferSlideCount(imageUrls, metadata) || 1;

            if (downloadTargets.length === 0) {
                logger.warn('[image-analyzer] No download targets available, returning placeholder analysis', {
                    slide_count: fallbackSlideCount,
                });
                return this._buildPlaceholderSlides(fallbackSlideCount);
            }

            logger.info('[image-analyzer] Starting image analysis', {
                count: downloadTargets.length,
                total_slides: downloadTargets.length,
                video_count: metadata.video_count || 0,
                extracted_frames: metadata.extractedFrames?.length || 0,
            });

            const downloadResults = await this._downloadImageTargets(downloadTargets);
            const successfulDownloads = downloadResults.filter((result) => !!result.base64);

            logger.debug(`[image-analyzer] Converted ${successfulDownloads.length}/${downloadResults.length} images to base64`);

            if (successfulDownloads.length === 0) {
                logger.warn('[image-analyzer] All image downloads failed, returning placeholder analysis');
                return this._buildPlaceholderSlides(downloadTargets.length);
            }

            let parsedSlides;
            if (successfulDownloads.length === downloadResults.length) {
                try {
                    const rawOutput = await this._requestVisionAnalysis(
                        successfulDownloads.map((result) => result.base64),
                        downloadTargets.length,
                    );
                    parsedSlides = this.parseSlideOutput(rawOutput);
                } catch (error) {
                    logger.warn(`[image-analyzer] Batch vision analysis failed, falling back to per-slide analysis: ${error.message}`);
                    parsedSlides = await this._analyzeDownloadedImagesIndividually(downloadResults);
                }
            } else {
                logger.warn(`[image-analyzer] Partial image download success (${successfulDownloads.length}/${downloadResults.length}); analyzing available slides individually`);
                parsedSlides = await this._analyzeDownloadedImagesIndividually(downloadResults);
            }

            const normalizedSlides = this._normalizeParsedSlides(parsedSlides, downloadTargets.length);

            logger.info('[image-analyzer] Image analysis completed', {
                slides_analyzed: normalizedSlides.length,
            });

            return normalizedSlides;
        } catch (error) {
            logger.error('[image-analyzer] Failed to analyze images', {
                error: error.message,
                stack: error.stack,
            });
            throw error;
        }
    }

    /**
     * Parse the custom slide output format.
     * @param {string} rawOutput
     * @returns {Array}
     */
    parseSlideOutput(rawOutput) {
        if (!rawOutput || typeof rawOutput !== 'string') {
            return [];
        }

        logger.debug(`[image-analyzer] Raw output length: ${rawOutput.length}`);
        logger.debug(`[image-analyzer] Raw output preview: ${rawOutput.substring(0, 500)}...`);

        const jsonSlides = this._parseJsonSlides(rawOutput);
        if (jsonSlides.length > 0) {
            logger.debug(`[image-analyzer] Parsed ${jsonSlides.length} slides as JSON`);
            return jsonSlides;
        }

        const slides = [];
        const blockRegex = /slide\s*#?\s*(\d+)\s*[:{]([\s\S]*?)(?=(?:slide\s*#?\s*\d+\s*[:{])|$)/gi;

        let match;
        while ((match = blockRegex.exec(rawOutput)) !== null) {
            const slideNumber = Number.parseInt(match[1], 10);
            const block = match[2] || '';
            const texto = this._extractTextField(block);
            const descricao = this._extractDescriptionField(block);

            if (texto || descricao) {
                slides.push({
                    slide: slideNumber,
                    texto: texto || DEFAULT_SLIDE_TEXT,
                    descricao: descricao || GENERIC_VISUAL_FALLBACK,
                });
            }
        }

        if (slides.length > 0) {
            logger.debug(`[image-analyzer] Parsed ${slides.length} slides from text blocks`);
            return slides.sort((left, right) => left.slide - right.slide);
        }

        const fallbackText = this._extractTextField(rawOutput);
        const fallbackDescription = this._extractDescriptionField(rawOutput);
        if (fallbackText || fallbackDescription) {
            logger.debug('[image-analyzer] Parsed a single fallback slide from raw output');
            return [{
                slide: 1,
                texto: fallbackText || DEFAULT_SLIDE_TEXT,
                descricao: fallbackDescription || GENERIC_VISUAL_FALLBACK,
            }];
        }

        logger.warn('[image-analyzer] All parsing methods failed, returning generic fallback');
        return [{
            slide: 1,
            texto: DEFAULT_SLIDE_TEXT,
            descricao: GENERIC_VISUAL_FALLBACK,
        }];
    }

    _parseJsonSlides(rawOutput) {
        try {
            const cleaned = rawOutput
                .replace(/^```json\s*/i, '')
                .replace(/^```\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();

            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed)) {
                return parsed.map((slide, index) => this._coerceSlideAnalysis(slide, index + 1));
            }

            if (Array.isArray(parsed?.slides)) {
                return parsed.slides.map((slide, index) => this._coerceSlideAnalysis(slide, index + 1));
            }
        } catch {
            logger.debug('[image-analyzer] JSON parse failed, continuing with text parsing');
        }

        return [];
    }

    _extractTextField(text) {
        const patterns = [
            /texto\s*:\s*"""([\s\S]*?)"""/i,
            /(?:texto|text|ocr)\s*[:=]\s*["'`]([\s\S]*?)["'`]/i,
            /(?:texto|text|ocr)\s*[:=]\s*([^\n\r}]+)/i,
        ];

        return this._extractField(text, patterns);
    }

    _extractDescriptionField(text) {
        const patterns = [
            new RegExp(`${DESCRIPTION_FIELD_PATTERN}\\s*[:=]\\s*"([\\s\\S]*?)"`, 'i'),
            new RegExp(`${DESCRIPTION_FIELD_PATTERN}\\s*[:=]\\s*'([\\s\\S]*?)'`, 'i'),
            new RegExp(`${DESCRIPTION_FIELD_PATTERN}\\s*[:=]\\s*\`([\\s\\S]*?)\``, 'i'),
            new RegExp(`${DESCRIPTION_FIELD_PATTERN}\\s*[:=]\\s*([^\\n\\r}]+)`, 'i'),
        ];

        return this._extractField(text, patterns);
    }

    _extractField(text, patterns) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        for (const pattern of patterns) {
            const match = pattern.exec(text);
            if (match?.[1]) {
                return match[1].trim();
            }
        }

        return '';
    }

    _coerceSlideAnalysis(slide, defaultSlideNumber) {
        const texto = typeof slide?.texto === 'string'
            ? slide.texto.trim()
            : typeof slide?.text === 'string'
                ? slide.text.trim()
                : typeof slide?.ocr === 'string'
                    ? slide.ocr.trim()
                    : '';

        const descricao = [
            slide?.descricao,
            slide?.['descri\u00e7\u00e3o'],
            slide?.description,
            slide?.desc,
        ].find((value) => typeof value === 'string' && value.trim());

        return {
            slide: Number(slide?.slide || defaultSlideNumber),
            texto: texto || DEFAULT_SLIDE_TEXT,
            descricao: descricao?.trim() || VISUAL_ANALYSIS_UNAVAILABLE,
        };
    }

    _buildDownloadTargets(imageUrls, metadata = {}) {
        const extractedFrames = Array.isArray(metadata.extractedFrames) ? metadata.extractedFrames : [];
        const sourceEntries = this._normalizeSourceEntries(metadata);
        const targets = [];
        let frameIndex = 0;

        for (const sourceEntry of sourceEntries) {
            const sourceMetadata = sourceEntry?.metadata || sourceEntry;
            const sourceSlides = Array.isArray(sourceMetadata?.slides) ? sourceMetadata.slides : [];

            for (const slide of sourceSlides) {
                const candidateUrls = [];

                if (slide?.type === 'video') {
                    const frame = extractedFrames[frameIndex];
                    frameIndex += 1;

                    if (frame?.extractedThumbnailUrl) candidateUrls.push(frame.extractedThumbnailUrl);
                    if (frame?.thumbnailUrl) candidateUrls.push(frame.thumbnailUrl);
                    if (slide?.thumbnailUrl) candidateUrls.push(slide.thumbnailUrl);
                    if (slide?.url) candidateUrls.push(slide.url);
                } else {
                    if (slide?.url) candidateUrls.push(slide.url);
                    if (slide?.thumbnailUrl) candidateUrls.push(slide.thumbnailUrl);
                    for (const fallbackUrl of slide?.alternativeImageUrls || []) {
                        candidateUrls.push(fallbackUrl);
                    }
                }

                targets.push({
                    slideNumber: targets.length + 1,
                    candidateUrls: Array.from(new Set(candidateUrls.filter(Boolean))),
                    sourceCode: sourceEntry?.code || sourceMetadata?.shortcode || 'primary',
                    slidePosition: typeof slide?.position === 'number' ? slide.position : targets.length,
                });
            }
        }

        if (targets.length > 0) {
            return targets;
        }

        return (imageUrls || [])
            .filter(Boolean)
            .map((url, index) => ({
                slideNumber: index + 1,
                candidateUrls: [url],
                sourceCode: 'fallback',
                slidePosition: index,
            }));
    }

    _normalizeSourceEntries(metadata = {}) {
        if (Array.isArray(metadata.sources)) {
            return metadata.sources;
        }

        if (metadata.sources?.slides) {
            return [{
                code: metadata.sources.shortcode || 'primary',
                metadata: metadata.sources,
            }];
        }

        if (metadata.slides) {
            return [{
                code: metadata.shortcode || 'primary',
                metadata,
            }];
        }

        return [];
    }

    _inferSlideCount(imageUrls, metadata = {}) {
        const sourceEntries = this._normalizeSourceEntries(metadata);
        const sourceSlideCount = sourceEntries.reduce((count, sourceEntry) => {
            const sourceMetadata = sourceEntry?.metadata || sourceEntry;
            return count + (Array.isArray(sourceMetadata?.slides) ? sourceMetadata.slides.length : 0);
        }, 0);

        if (sourceSlideCount > 0) {
            return sourceSlideCount;
        }

        const extractedFrameCount = Array.isArray(metadata.extractedFrames) ? metadata.extractedFrames.length : 0;
        if (extractedFrameCount > 0) {
            return extractedFrameCount;
        }

        return Array.isArray(imageUrls) ? imageUrls.filter(Boolean).length : 0;
    }

    _buildPlaceholderSlides(count) {
        return Array.from({ length: Math.max(1, count) }, (_, index) => this._buildUnavailableSlideAnalysis(index + 1));
    }

    async _downloadImageTargets(targets) {
        logger.debug(`[image-analyzer] Downloading ${targets.length} images with resilience...`);

        const results = new Array(targets.length);
        let nextIndex = 0;

        const processNextTarget = async () => {
            while (true) {
                const currentIndex = nextIndex;
                nextIndex += 1;

                if (currentIndex >= targets.length) {
                    return;
                }

                results[currentIndex] = await this._downloadTargetWithFallbacks(
                    targets[currentIndex],
                    currentIndex + 1,
                    targets.length,
                );
            }
        };

        const workerCount = Math.min(IMAGE_DOWNLOAD_CONCURRENCY, targets.length);
        await Promise.all(Array.from({ length: workerCount }, () => processNextTarget()));
        return results;
    }

    async _downloadTargetWithFallbacks(target, index, total) {
        const candidateUrls = Array.from(new Set((target.candidateUrls || []).filter(Boolean)));
        let lastErrorMessage = 'no download url available';

        if (candidateUrls.length === 0) {
            logger.warn(`[image-analyzer] Slide ${target.slideNumber} has no candidate image URL, using placeholder analysis`);
            return {
                ...target,
                base64: null,
                errorMessage: lastErrorMessage,
            };
        }

        for (const candidateUrl of candidateUrls) {
            for (let attempt = 1; attempt <= IMAGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
                try {
                    const base64 = await this._downloadSingleImage(candidateUrl, index, total, attempt);
                    return {
                        ...target,
                        base64,
                        downloadedUrl: candidateUrl,
                    };
                } catch (error) {
                    lastErrorMessage = error.message || lastErrorMessage;
                    const retryable = this._isRetryableImageError(error);
                    const isLastAttempt = attempt >= IMAGE_DOWNLOAD_ATTEMPTS;

                    if (!retryable || isLastAttempt) {
                        break;
                    }

                    await this._sleep(250 * attempt);
                }
            }
        }

        logger.warn(`[image-analyzer] Falling back to placeholder analysis for slide ${target.slideNumber}: ${lastErrorMessage}`);
        return {
            ...target,
            base64: null,
            errorMessage: lastErrorMessage,
        };
    }

    async _downloadSingleImage(url, index, total, attempt = 1) {
        logger.debug(`[image-analyzer] Downloading image ${index}/${total} (attempt ${attempt})`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Accept: 'image/*',
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
                error.status = response.status;
                throw error;
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const base64 = buffer.toString('base64');

            logger.debug(`[image-analyzer] Image ${index}/${total} downloaded (${(buffer.length / 1024).toFixed(2)} KB)`);
            return base64;
        } catch (error) {
            if (error.name === 'AbortError') {
                const timeoutError = new Error(`timeout after ${IMAGE_DOWNLOAD_TIMEOUT_MS}ms`);
                timeoutError.status = 408;
                throw timeoutError;
            }

            logger.error(`[image-analyzer] Failed to download image ${index}/${total}:`, error.message);
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async _requestVisionAnalysis(base64Images, imageCount) {
        const systemPrompt = await PromptLoader.loadSystem('imageAnalyzer');
        const userPrompt = await PromptLoader.loadUser('imageAnalyzer', {
            image_count: imageCount,
        });

        const imageMessages = base64Images.map((base64) => ({
            type: 'image_url',
            image_url: {
                url: `data:image/jpeg;base64,${base64}`,
                detail: 'low',
            },
        }));

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: userPrompt,
                        },
                        ...imageMessages,
                    ],
                },
            ],
            max_tokens: 2500,
            temperature: 0.3,
        });

        if (this.tokenTracker) {
            recordTokens(this.tokenTracker, 'image_analyzer', response);
        }

        const rawOutput = response.choices[0]?.message?.content?.trim();
        if (!rawOutput) {
            throw new Error('Empty response from GPT-4O Vision');
        }

        return rawOutput;
    }

    async _analyzeDownloadedImagesIndividually(downloadResults) {
        const parsedSlides = [];

        for (const result of downloadResults) {
            if (!result.base64) {
                parsedSlides.push(this._buildUnavailableSlideAnalysis(result.slideNumber));
                continue;
            }

            try {
                const rawOutput = await this._requestVisionAnalysis([result.base64], 1);
                const normalizedSingleSlide = this._normalizeParsedSlides(this.parseSlideOutput(rawOutput), 1)[0];

                parsedSlides.push({
                    slide: result.slideNumber,
                    texto: normalizedSingleSlide?.texto || DEFAULT_SLIDE_TEXT,
                    descricao: normalizedSingleSlide?.descricao || VISUAL_ANALYSIS_AVAILABLE,
                });
            } catch (error) {
                logger.warn(`[image-analyzer] Vision fallback failed for slide ${result.slideNumber}: ${error.message}`);
                parsedSlides.push(this._buildUnavailableSlideAnalysis(result.slideNumber));
            }
        }

        return parsedSlides;
    }

    _normalizeParsedSlides(parsedSlides, expectedCount) {
        const bySlide = new Map();

        for (const [index, slide] of (Array.isArray(parsedSlides) ? parsedSlides : []).entries()) {
            const normalizedSlide = this._coerceSlideAnalysis(slide, index + 1);
            bySlide.set(normalizedSlide.slide, normalizedSlide);
        }

        const normalizedSlides = [];
        for (let slideNumber = 1; slideNumber <= expectedCount; slideNumber += 1) {
            normalizedSlides.push(bySlide.get(slideNumber) || this._buildUnavailableSlideAnalysis(slideNumber));
        }

        return normalizedSlides;
    }

    _buildUnavailableSlideAnalysis(slideNumber) {
        return {
            slide: slideNumber,
            texto: DEFAULT_SLIDE_TEXT,
            descricao: VISUAL_ANALYSIS_UNAVAILABLE,
        };
    }

    _isRetryableImageError(error) {
        const status = Number(error?.status || 0);
        return RETRYABLE_IMAGE_STATUS_CODES.has(status) || /timeout/i.test(String(error?.message || ''));
    }

    _sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
