const MOJIBAKE_PATTERN = /(Ã.|Â.|â€|â€™|â€œ|â€\x9d|â€“|â€”|�)/u;

const COMMON_MOJIBAKE_REPLACEMENTS = new Map([
    ['â€\x9d', '”'],
    ['â€\x9c', '“'],
    ['â€™', '’'],
    ['â€˜', '‘'],
    ['â€¦', '…'],
    ['â€“', '–'],
    ['â€”', '—'],
    ['\u00C2\u00A0', ' '],
    ['\u00C3\u00A1', 'á'],
    ['\u00C3\u00A0', 'à'],
    ['\u00C3\u00A2', 'â'],
    ['\u00C3\u00A3', 'ã'],
    ['\u00C3\u00A4', 'ä'],
    ['\u00C3\u00A9', 'é'],
    ['\u00C3\u00AA', 'ê'],
    ['\u00C3\u00AD', 'í'],
    ['\u00C3\u00B3', 'ó'],
    ['\u00C3\u00B4', 'ô'],
    ['\u00C3\u00B5', 'õ'],
    ['\u00C3\u00B6', 'ö'],
    ['\u00C3\u00BA', 'ú'],
    ['\u00C3\u00BC', 'ü'],
    ['\u00C3\u00A7', 'ç'],
    ['\u00C3\u0081', 'Á'],
    ['\u00C3\u0080', 'À'],
    ['\u00C3\u0082', 'Â'],
    ['\u00C3\u0083', 'Ã'],
    ['\u00C3\u0089', 'É'],
    ['\u00C3\u008A', 'Ê'],
    ['\u00C3\u008D', 'Í'],
    ['\u00C3\u0093', 'Ó'],
    ['\u00C3\u0094', 'Ô'],
    ['\u00C3\u0095', 'Õ'],
    ['\u00C3\u009A', 'Ú'],
    ['\u00C3\u0087', 'Ç'],
]);

function countMojibakeMarkers(text) {
    return (String(text || '').match(new RegExp(MOJIBAKE_PATTERN, 'gu')) || []).length;
}

function repairLatin1Mojibake(text) {
    try {
        return Buffer.from(String(text || ''), 'latin1').toString('utf8');
    } catch {
        return String(text || '');
    }
}

function repairCommonMojibakeSequences(text) {
    let repaired = String(text || '');

    for (const [broken, fixed] of COMMON_MOJIBAKE_REPLACEMENTS.entries()) {
        repaired = repaired.split(broken).join(fixed);
    }

    return repaired;
}

export function looksLikeBrokenEncoding(text) {
    return countMojibakeMarkers(text) > 0;
}

export function sanitizeGeneratedText(text) {
    if (text === undefined || text === null) return text;

    let sanitized = String(text)
        .replace(/\u00A0/g, ' ')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .normalize('NFC');

    sanitized = repairCommonMojibakeSequences(sanitized);

    if (looksLikeBrokenEncoding(sanitized)) {
        const repaired = repairLatin1Mojibake(sanitized).normalize('NFC');
        if (countMojibakeMarkers(repaired) < countMojibakeMarkers(sanitized)) {
            sanitized = repaired;
        }
    }

    return sanitized;
}

export function sanitizeCarouselSlides(slides = []) {
    return slides.map((slide) => ({
        ...slide,
        title: sanitizeGeneratedText(slide?.title),
        subtitle: sanitizeGeneratedText(slide?.subtitle),
        content: sanitizeGeneratedText(slide?.content),
        cta: sanitizeGeneratedText(slide?.cta),
        call_to_action: sanitizeGeneratedText(slide?.call_to_action),
    }));
}

export function sanitizeCarouselDescription(description) {
    return sanitizeGeneratedText(description);
}