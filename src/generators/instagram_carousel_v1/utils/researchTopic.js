function normalizeText(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

const AUTO_CONTEXT_PATTERNS = [
    /^INSTRUÇÃO DE CTA:/i,
    /^INSTRUÇÃO IMPORTANTE:\s*A descrição/i,
];

export function stripAutomaticContextInstructions(userContext = '') {
    return String(userContext || '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !AUTO_CONTEXT_PATTERNS.some((pattern) => pattern.test(line)))
        .join(' ')
        .trim();
}

export function pickResearchTopic({
    userContext = '',
    firstCaption = '',
    businessObjective = '',
    businessName = '',
} = {}) {
    const explicitContext = normalizeText(stripAutomaticContextInstructions(userContext));
    if (explicitContext) {
        return explicitContext.substring(0, 240);
    }

    const normalizedCaption = normalizeText(firstCaption);
    if (normalizedCaption) {
        return normalizedCaption.substring(0, 200);
    }

    const normalizedObjective = normalizeText(businessObjective);
    if (normalizedObjective) {
        return normalizedObjective.substring(0, 240);
    }

    return normalizeText(businessName).substring(0, 120);
}