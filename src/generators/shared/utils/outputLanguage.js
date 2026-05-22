const LANGUAGE_ALIASES = {
    en: ['en', 'en-us', 'en-gb', 'english', 'ingles', 'inglês'],
    pt: ['pt', 'pt-br', 'pt-pt', 'portuguese', 'portugues', 'português', 'portugues brasileiro', 'português brasileiro'],
};

const LANGUAGE_LABELS = {
    en: 'English',
    pt: 'Brazilian Portuguese',
};

const ENGLISH_STOPWORDS = new Set([
    'the', 'and', 'that', 'with', 'this', 'from', 'they', 'your', 'have', 'more', 'about', 'into', 'will', 'their',
    'what', 'when', 'where', 'which', 'there', 'because', 'should', 'people', 'already', 'thinking', 'content', 'save',
    'buy', 'most', 'make', 'made', 'like', 'just', 'than', 'those', 'these', 'before', 'after', 'while', 'without',
]);

const PORTUGUESE_STOPWORDS = new Set([
    'que', 'para', 'com', 'como', 'mais', 'uma', 'esse', 'essa', 'isso', 'ainda', 'porque', 'quando', 'onde', 'entre',
    'sobre', 'depois', 'antes', 'tudo', 'nada', 'pelos', 'pelas', 'seus', 'suas', 'voce', 'você', 'ja', 'já', 'nao',
    'não', 'conteudo', 'conteúdo', 'carrossel', 'slides', 'titulo', 'título', 'subtitulo', 'subtítulo', 'sempre',
]);

function normalizeLanguageToken(raw) {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

export function normalizeOutputLanguage(raw) {
    const normalized = normalizeLanguageToken(raw);
    if (!normalized) return null;

    for (const [code, aliases] of Object.entries(LANGUAGE_ALIASES)) {
        if (aliases.includes(normalized)) {
            return {
                code,
                label: LANGUAGE_LABELS[code],
            };
        }
    }

    return null;
}

function extractWords(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .match(/[a-z]+/g) || [];
}

function scoreLanguage(words, dictionary) {
    return words.reduce((score, word) => score + (dictionary.has(word) ? 1 : 0), 0);
}

export function inferOutputLanguageFromText(...texts) {
    const words = texts.flatMap((text) => extractWords(text));
    if (words.length === 0) return null;

    const englishScore = scoreLanguage(words, ENGLISH_STOPWORDS);
    const portugueseScore = scoreLanguage(words, PORTUGUESE_STOPWORDS);

    if (englishScore === 0 && portugueseScore === 0) return null;
    if (englishScore >= portugueseScore * 1.15) return { code: 'en', label: LANGUAGE_LABELS.en };
    if (portugueseScore >= englishScore * 1.15) return { code: 'pt', label: LANGUAGE_LABELS.pt };

    return englishScore >= portugueseScore
        ? { code: 'en', label: LANGUAGE_LABELS.en }
        : { code: 'pt', label: LANGUAGE_LABELS.pt };
}

export function resolveOutputLanguage({ explicitLanguage = null, sourceTexts = [], fallback = 'pt' } = {}) {
    const normalizedExplicit = normalizeOutputLanguage(explicitLanguage);
    if (normalizedExplicit) return normalizedExplicit;

    const inferred = inferOutputLanguageFromText(...sourceTexts);
    if (inferred) return inferred;

    return {
        code: fallback,
        label: LANGUAGE_LABELS[fallback] || LANGUAGE_LABELS.pt,
    };
}

export function buildOutputLanguageInstruction(outputLanguage) {
    if (!outputLanguage?.label) return '';

    return `

━━━━━━━━━━━━━━━━━━━━━━
INSTRUCAO DE IDIOMA
━━━━━━━━━━━━━━━━━━━━━━

Escreva TODO o carrossel inteiramente em ${outputLanguage.label}.

Regras obrigatorias:
1. Nao misture idiomas entre title, subtitle, caption, CTA ou descricao.
2. Preserve nomes proprios, marcas, produtos e quotes oficiais da fonte apenas quando forem indispensaveis.
3. Se uma frase da fonte estiver em outro idioma e nao for um nome oficial, traduza para ${outputLanguage.label}.`;
}