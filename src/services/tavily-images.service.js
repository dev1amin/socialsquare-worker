/**
 * Tavily Images Service (worker)
 *
 * Usa Tavily Search com `include_images: true` para obter URLs de imagem
 * relacionadas à query, focado em fotos de pessoas onde Unsplash performa mal.
 *
 * Retorna { imagem_fundo, imagem_fundo2, imagem_fundo3, tavily_attributions }
 * compatível com o formato esperado pelo orchestrator.
 */

import { logger } from '../config/logger.js';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const DEFAULT_TIMEOUT_MS = 15000;

const PEOPLE_TERMS = [
    'person', 'people', 'man', 'woman', 'men', 'women',
    'boy', 'girl', 'kid', 'child', 'children', 'teen',
    'professional', 'entrepreneur', 'businessman', 'businesswoman',
    'team', 'group', 'crowd', 'audience',
    'portrait', 'headshot', 'face', 'selfie',
    'working', 'presenting', 'speaking', 'meeting',
    'doctor', 'lawyer', 'teacher', 'student', 'engineer', 'designer',
    'mom', 'mother', 'dad', 'father', 'family', 'couple',
    'human', 'humans', 'pessoa', 'pessoas', 'homem', 'mulher',
];

/**
 * Heurística: a keyword fala de pessoa(s)?
 */
export function isPersonKeyword(keyword) {
    if (!keyword || typeof keyword !== 'string') return false;
    const tokens = keyword.toLowerCase().split(/[^a-zA-ZÀ-ÿ]+/).filter(Boolean);
    return tokens.some((t) => PEOPLE_TERMS.includes(t));
}

function isLikelyImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    // aceita querystring
    return /\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i.test(url);
}

/**
 * Busca imagens via Tavily.
 * @param {string} keyword
 * @param {object} [opts]
 * @param {number} [opts.maxImages=3]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{imagem_fundo: string|null, imagem_fundo2: string|null, imagem_fundo3: string|null, tavily_attributions: Array<{url:string, source?:string}>|null}>}
 */
export async function searchPersonImages(keyword, opts = {}) {
    const empty = {
        imagem_fundo: null,
        imagem_fundo2: null,
        imagem_fundo3: null,
        tavily_attributions: null,
    };

    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        logger.warn('[tavily-images] TAVILY_API_KEY não configurada');
        return empty;
    }
    if (!keyword || !keyword.trim()) return empty;

    const { maxImages = 3, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(TAVILY_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                query: `${keyword.trim()} photo`,
                search_depth: 'basic',
                topic: 'general',
                include_answer: false,
                include_images: true,
                include_image_descriptions: false,
                max_results: 5,
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            logger.warn(`[tavily-images] HTTP ${res.status}: ${txt.substring(0, 200)}`);
            return empty;
        }

        const data = await res.json();

        // Top-level images: pode ser array de strings ou de { url, description }
        const rawTop = Array.isArray(data.images) ? data.images : [];
        const candidates = [];

        for (const item of rawTop) {
            const url = typeof item === 'string' ? item : item?.url;
            if (isLikelyImageUrl(url) && !candidates.find((c) => c.url === url)) {
                candidates.push({ url, source: null });
            }
        }

        // Per-result images (alguns retornos só populam aqui)
        if (Array.isArray(data.results)) {
            for (const r of data.results) {
                const imgs = Array.isArray(r?.images) ? r.images : [];
                for (const item of imgs) {
                    const url = typeof item === 'string' ? item : item?.url;
                    if (isLikelyImageUrl(url) && !candidates.find((c) => c.url === url)) {
                        candidates.push({ url, source: r.url || null });
                    }
                }
            }
        }

        const picked = candidates.slice(0, maxImages);
        if (picked.length === 0) {
            logger.warn(`[tavily-images] No usable images for "${keyword}"`);
            return empty;
        }

        return {
            imagem_fundo: picked[0]?.url ?? null,
            imagem_fundo2: picked[1]?.url ?? null,
            imagem_fundo3: picked[2]?.url ?? null,
            tavily_attributions: picked,
        };
    } catch (err) {
        if (err?.name === 'AbortError') {
            logger.warn(`[tavily-images] Timeout for "${keyword}"`);
        } else {
            logger.warn(`[tavily-images] Error for "${keyword}": ${err.message}`);
        }
        return empty;
    } finally {
        clearTimeout(timer);
    }
}
