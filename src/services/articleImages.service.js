/**
 * Article Images Service
 *
 * Extrai URLs de imagens do HTML de uma matéria/post:
 *  - og:image / twitter:image (capa principal)
 *  - article:image
 *  - imagens grandes dentro de <article> ou <main>
 *
 * Usado para alimentar slides com fotos REAIS da fonte original
 * (ex.: foto do MC Ryan SP que está na matéria do Metrópoles).
 */

import { logger } from '../config/logger.js';

const IMG_EXT_REGEX = /\.(jpg|jpeg|png|webp|gif|avif)(\?|#|$)/i;

function resolveUrl(maybeUrl, baseUrl) {
    if (!maybeUrl) return null;
    try {
        return new URL(maybeUrl, baseUrl).toString();
    } catch {
        return null;
    }
}

function pushUnique(arr, url) {
    if (!url) return;
    if (!IMG_EXT_REGEX.test(url) && !/cdn|image|img|photo/i.test(url)) return;
    if (arr.includes(url)) return;
    arr.push(url);
}

/**
 * Extrai URLs de imagens de um HTML de artigo.
 * @param {string} htmlText - HTML completo (ou já limpo) da matéria
 * @param {string} baseUrl - URL canônica da matéria (para resolver caminhos relativos)
 * @returns {{ cover: string|null, images: string[] }}
 */
export function extractArticleImages(htmlText, baseUrl) {
    if (!htmlText || typeof htmlText !== 'string') {
        return { cover: null, images: [] };
    }

    const images = [];
    let cover = null;

    // 1) og:image — pode ter múltiplas
    const ogMatches = htmlText.matchAll(
        /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/gi
    );
    for (const m of ogMatches) {
        const url = resolveUrl(m[1], baseUrl);
        pushUnique(images, url);
        if (!cover) cover = url;
    }
    // og:image em ordem invertida (content antes de property)
    const ogReverseMatches = htmlText.matchAll(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/gi
    );
    for (const m of ogReverseMatches) {
        const url = resolveUrl(m[1], baseUrl);
        pushUnique(images, url);
        if (!cover) cover = url;
    }

    // 2) twitter:image
    const twMatches = htmlText.matchAll(
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi
    );
    for (const m of twMatches) {
        const url = resolveUrl(m[1], baseUrl);
        pushUnique(images, url);
        if (!cover) cover = url;
    }

    // 3) article:image
    const artMatches = htmlText.matchAll(
        /<meta[^>]+property=["']article:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi
    );
    for (const m of artMatches) {
        pushUnique(images, resolveUrl(m[1], baseUrl));
    }

    // 4) <link rel="image_src">
    const linkImg = htmlText.match(
        /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i
    );
    if (linkImg) {
        pushUnique(images, resolveUrl(linkImg[1], baseUrl));
    }

    // 5) <img src="..."> dentro de <article> ou <main> (ou globais como fallback)
    const articleBlock =
        htmlText.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ||
        htmlText.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
        htmlText;

    const imgMatches = articleBlock.matchAll(
        /<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi
    );
    for (const m of imgMatches) {
        const url = resolveUrl(m[1], baseUrl);
        if (!url) continue;
        // Filtra ícones, sprites, avatars muito pequenos (heurística por nome)
        if (/sprite|icon|logo|avatar|favicon|pixel|tracking|1x1/i.test(url)) continue;
        pushUnique(images, url);
    }

    return { cover: cover || images[0] || null, images };
}

/**
 * Versão amigável que loga.
 */
export function extractArticleImagesLogged(htmlText, baseUrl, traceId = '') {
    const result = extractArticleImages(htmlText, baseUrl);
    logger.info(
        `[article-images]${traceId ? ` [${traceId}]` : ''} extracted ${result.images.length} image(s) from ${baseUrl} (cover=${result.cover ? 'yes' : 'no'})`
    );
    return result;
}
