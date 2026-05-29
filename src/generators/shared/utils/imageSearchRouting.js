function normalizeOptionalText(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

export function getTavilySearchQuery(slide) {
    return normalizeOptionalText(slide?.entity_name);
}

export function shouldUseTavilyImageSearch(slide) {
    return Boolean(getTavilySearchQuery(slide));
}