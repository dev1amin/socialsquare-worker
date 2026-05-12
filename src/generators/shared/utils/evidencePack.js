const GENERIC_PATTERNS = [
    /\b(?:descubra|saiba|aprenda|veja|entenda|conheca)\b/i,
    /\b(?:neste carrossel|nesse carrossel|neste post|nesse post)\b/i,
    /\b(?:dicas|segredos|truques|passo a passo)\b/i,
    /\b(?:e importante|vale lembrar|basicamente|no fim do dia)\b/i,
    /\b(?:mude sua vida|transforme sua rotina|vai explodir)\b/i,
    /\b(?:todo mundo|ninguem te conta|voce precisa)\b/i,
];

const NOISE_PATTERNS = [
    /\bloading\b/i,
    /\bopens? in a new window\b/i,
    /\bwhat'?s next\b/i,
    /\blivestream replay\b/i,
    /\bappendix\b/i,
    /\bhelp me find ios and android adoption rates\b/i,
    /\btop 10 developed economies\b/i,
    /\btop 10 developing\/emerging economies\b/i,
    /\bcountry ios market share\b/i,
    /\bshare february\b/i,
];

const SIGNAL_PATTERNS = {
    number: /(?:\b\d{1,4}(?:[\.,]\d+)?%\b|\b\d{1,4}(?:[\.,]\d+)?\b|R\$\s?\d|US\$\s?\d|\b\d+x\b)/i,
    date: /\b(?:20\d{2}|19\d{2}|jan(?:eiro)?|fev(?:ereiro)?|mar(?:co|ço)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\b/i,
    authority: /\b(?:segundo|estudo|pesquisa|levantamento|relatorio|relatório|dados|ibge|ocde|mckinsey|nielsen|meta|google|openai|tavily|receita federal)\b/i,
    mechanism: /\b(?:porque|por isso|resultado|efeito|causa|mecanismo|explica|mostra|revela|indica|compara|reduz|aumenta|caiu|cresceu)\b/i,
    contrast: /\b(?:antes|depois|enquanto|mas|so que|por outro lado|ao inves|em vez)\b/i,
};

const PORTUGUESE_STOPWORDS = new Set([
    'a', 'ao', 'aos', 'aquela', 'aquele', 'aqueles', 'aquilo', 'as', 'ate', 'com', 'como', 'da', 'das',
    'de', 'dela', 'dele', 'deles', 'depois', 'do', 'dos', 'e', 'ela', 'elas', 'ele', 'eles', 'em', 'entre',
    'era', 'essa', 'esse', 'esta', 'estao', 'estas', 'este', 'estes', 'eu', 'foi', 'foram', 'isso', 'isto',
    'ja', 'mais', 'mas', 'me', 'mesmo', 'na', 'nas', 'nao', 'nem', 'no', 'nos', 'nossa', 'nosso', 'o', 'os',
    'ou', 'para', 'pela', 'pelas', 'pelo', 'pelos', 'por', 'pra', 'que', 'se', 'sem', 'ser', 'seu', 'seus',
    'sua', 'suas', 'tambem', 'tem', 'tendo', 'ter', 'teu', 'teus', 'um', 'uma', 'umas', 'uns', 'vai', 'voce', 'voces'
]);

function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(text) {
    return normalizeWhitespace(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

    function stripHtml(text) {
        return String(text || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<!--([\s\S]*?)-->/g, ' ')
        .replace(/<[^>]+>/g, ' ');
    }

function splitLongChunk(chunk) {
    if (chunk.length <= 240) return [chunk];

    const phrases = chunk
        .split(/[,;:()]|\s+-\s+/)
        .map((part) => normalizeWhitespace(part))
        .filter(Boolean);

    if (phrases.length <= 1) {
        return [chunk.slice(0, 240)];
    }

    const segments = [];
    let current = '';

    for (const phrase of phrases) {
        if (!current) {
            current = phrase;
            continue;
        }

        if (`${current}, ${phrase}`.length <= 240) {
            current = `${current}, ${phrase}`;
        } else {
            segments.push(current);
            current = phrase;
        }
    }

    if (current) segments.push(current);
    return segments;
}

function splitIntoClaims(text) {
    const cleaned = normalizeWhitespace(text.replace(/[•▪◦·]/g, '. '));
    if (!cleaned) return [];

    const chunks = cleaned
        .split(/(?<=[\.!?])\s+|\n+/)
        .map((chunk) => normalizeWhitespace(chunk))
        .filter(Boolean)
        .flatMap((chunk) => splitLongChunk(chunk))
        .map((chunk) => normalizeWhitespace(chunk.replace(/^[-–—]\s*/, '')))
        .filter((chunk) => chunk.length >= 35 && chunk.length <= 240)
        .filter((chunk) => !looksLikeNoiseClaim(chunk));

    return chunks;
}

function looksLikeNoiseClaim(text) {
    return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function extractProperNouns(text) {
    const matches = text.match(/\b(?:[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][\p{L}0-9&.-]+(?:\s+[A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ][\p{L}0-9&.-]+){0,2})/gu) || [];
    return Array.from(new Set(matches.map((match) => normalizeWhitespace(match)).filter((match) => match.length > 2)));
}

function extractNumericAnchors(text) {
    return Array.from(new Set((text.match(/(?:\b\d{1,4}(?:[\.,]\d+)?%\b|R\$\s?\d[\d\.,]*|US\$\s?\d[\d\.,]*|\b20\d{2}\b|\b19\d{2}\b|\b\d{1,4}(?:[\.,]\d+)?\b)/g) || []).map((match) => normalizeWhitespace(match))));
}

function extractKeywordAnchors(text) {
    const normalized = normalizeWhitespace(text)
        .replace(/["'“”‘’()[\]{}]/g, ' ')
        .split(/[^\p{L}\p{N}&.-]+/u)
        .map((word) => normalizeKey(word))
        .filter((word) => word.length >= 6 && !PORTUGUESE_STOPWORDS.has(word));

    return Array.from(new Set(normalized)).slice(0, 8);
}

function hasGenericLanguage(text) {
    return GENERIC_PATTERNS.some((pattern) => pattern.test(text));
}

function buildSignalTags(text) {
    return Object.entries(SIGNAL_PATTERNS)
        .filter(([, pattern]) => pattern.test(text))
        .map(([tag]) => tag);
}

function scoreClaim(text, source, positionIndex, totalClaims) {
    const signalTags = buildSignalTags(text);
    const numericAnchors = extractNumericAnchors(text);
    const properNouns = extractProperNouns(text);
    const keywordAnchors = extractKeywordAnchors(text);
    const genericPenalty = hasGenericLanguage(text) ? 4 : 0;

    let score = 0;
    score += signalTags.length * 3;
    score += Math.min(3, numericAnchors.length) * 2;
    score += Math.min(3, properNouns.length) * 2;
    score += Math.min(4, keywordAnchors.length);
    score += text.length >= 70 && text.length <= 180 ? 2 : 0;
    score -= genericPenalty;

    if (source.type === 'research') score += 2;
    if (source.type === 'instagram') score += 1;
    if (source.type === 'image_analysis') score -= 1;
    if (positionIndex <= Math.max(1, Math.floor(totalClaims * 0.2))) score += 1;

    return {
        score,
        signalTags,
        numericAnchors,
        properNouns,
        keywordAnchors,
        genericPenalty,
    };
}

function jaccardSimilarity(aTokens, bTokens) {
    const a = new Set(aTokens);
    const b = new Set(bTokens);
    const intersection = new Set([...a].filter((token) => b.has(token)));
    const unionSize = new Set([...a, ...b]).size;
    return unionSize === 0 ? 0 : intersection.size / unionSize;
}

function dedupeClaims(claims) {
    const sorted = [...claims].sort((left, right) => right.score - left.score);
    const kept = [];

    for (const claim of sorted) {
        const claimTokens = claim.keywordAnchors;
        const duplicated = kept.some((existing) => {
            const overlap = jaccardSimilarity(claimTokens, existing.keywordAnchors);
            const sameNumbers = claim.numericAnchors.length > 0
                && claim.numericAnchors.some((anchor) => existing.numericAnchors.includes(anchor));
            return overlap >= 0.72 || (sameNumbers && overlap >= 0.45);
        });

        if (!duplicated) kept.push(claim);
    }

    return kept.sort((left, right) => right.score - left.score);
}

function buildSourceEntry(source, index) {
    const maxLength = source.type === 'news' ? 8000 : 16000;
    const content = normalizeWhitespace(stripHtml(source.content || source.text || '').slice(0, maxLength));
    const label = source.label
        || source.title
        || source.code
        || source.url
        || `${source.type || 'source'}-${index + 1}`;

    return {
        id: source.id || `${source.type || 'source'}-${index + 1}`,
        type: source.type || 'source',
        label,
        content,
        raw: source,
    };
}

function buildClaimsFromSources(sources) {
    const allClaims = [];

    for (const source of sources) {
        const claims = splitIntoClaims(source.content);

        claims.forEach((claimText, index) => {
            const scored = scoreClaim(claimText, source, index, claims.length);

            allClaims.push({
                id: `${source.id}-claim-${index + 1}`,
                sourceId: source.id,
                sourceLabel: source.label,
                sourceType: source.type,
                text: claimText,
                ...scored,
            });
        });
    }

    return dedupeClaims(allClaims);
}

function allocateRoles(screenCount, hasCta) {
    const baseRoles = ['hook', 'tension', 'diagnosis', 'proof', 'mechanism', 'implication', 'example', 'contrast', 'takeaway'];
    const roles = [];

    for (let index = 0; index < screenCount; index += 1) {
        if (index === 0) {
            roles.push('hook');
            continue;
        }

        if (hasCta && index === screenCount - 1) {
            roles.push('cta');
            continue;
        }

        roles.push(baseRoles[(index - 1) % (baseRoles.length - 1)] || 'support');
    }

    return roles;
}

function scoreClaimForRole(claim, role) {
    const roleWeights = {
        hook: (claim.numericAnchors.length * 3) + (claim.properNouns.length * 2) + (claim.signalTags.includes('contrast') ? 2 : 0),
        tension: (claim.signalTags.includes('contrast') ? 4 : 0) + (claim.signalTags.includes('mechanism') ? 2 : 0),
        diagnosis: (claim.signalTags.includes('mechanism') ? 4 : 0) + (claim.keywordAnchors.length >= 4 ? 2 : 0),
        proof: (claim.numericAnchors.length * 4) + (claim.signalTags.includes('authority') ? 3 : 0),
        mechanism: (claim.signalTags.includes('mechanism') ? 4 : 0) + (claim.keywordAnchors.length >= 5 ? 1 : 0),
        implication: (claim.signalTags.includes('contrast') ? 2 : 0) + (claim.keywordAnchors.length >= 4 ? 2 : 0),
        example: (claim.properNouns.length * 3) + (claim.numericAnchors.length * 2),
        contrast: (claim.signalTags.includes('contrast') ? 4 : 0) + (claim.numericAnchors.length > 0 ? 1 : 0),
        takeaway: (claim.signalTags.includes('authority') ? 1 : 0) + (claim.keywordAnchors.length >= 4 ? 2 : 0),
        cta: 1,
        support: 1,
    };

    return claim.score + (roleWeights[role] || 0);
}

function buildClaimAnchorEntries(claim) {
    return [
        ...(claim?.numericAnchors || []).filter((anchor) => isMeaningfulNumericAnchor(anchor)).map((anchor) => ({
            label: anchor,
            value: normalizeKey(anchor),
            hard: true,
        })),
        ...(claim?.properNouns || []).map((anchor) => ({
            label: anchor,
            value: normalizeKey(anchor),
            hard: true,
        })),
        ...(claim?.keywordAnchors || []).map((anchor) => ({
            label: anchor,
            value: normalizeKey(anchor),
            hard: false,
        })),
    ].filter((entry) => entry.value);
}

function isMeaningfulNumericAnchor(anchor) {
    const normalized = normalizeWhitespace(anchor);
    if (!normalized) return false;

    if (/%|R\$|US\$|x\b|[\.,]/.test(normalized)) return true;
    if (/^(?:19|20)\d{2}$/.test(normalized)) return true;

    const digits = normalized.replace(/\D/g, '');
    return digits.length >= 3;
}

function buildAnchorFrequency(claims) {
    const frequency = new Map();

    for (const claim of claims) {
        const uniqueAnchors = new Set(buildClaimAnchorEntries(claim).map((entry) => entry.value));
        for (const anchor of uniqueAnchors) {
            frequency.set(anchor, (frequency.get(anchor) || 0) + 1);
        }
    }

    return frequency;
}

function selectRequiredAnchors(claim, anchorFrequency, limit = 3) {
    return buildClaimAnchorEntries(claim)
        .filter((entry, index, list) => list.findIndex((candidate) => candidate.value === entry.value) === index)
        .sort((left, right) => {
            const hardDelta = Number(right.hard) - Number(left.hard);
            if (hardDelta !== 0) return hardDelta;

            const frequencyDelta = (anchorFrequency.get(left.value) || 99) - (anchorFrequency.get(right.value) || 99);
            if (frequencyDelta !== 0) return frequencyDelta;

            return right.label.length - left.label.length;
        })
        .slice(0, limit)
        .map((entry) => entry.label);
}

function buildSlidePlan(claims, sources, { screenCount, hasCta = false, templateSlides = [] } = {}) {
    const roles = allocateRoles(screenCount, hasCta);
    const titleOnlyMask = Array.isArray(templateSlides)
        ? templateSlides.map((slide) => !slide?.subtitle)
        : [];
    const requiredPerSource = new Map();
    const anchorFrequency = buildAnchorFrequency(claims);

    for (const source of sources) {
        const topClaim = claims.find((claim) => claim.sourceId === source.id);
        if (topClaim) requiredPerSource.set(source.id, topClaim.id);
    }

    const usedClaimIds = new Set();
    const slidePlan = [];

    for (let index = 0; index < screenCount; index += 1) {
        const role = roles[index] || 'support';
        const titleOnly = titleOnlyMask.length > 0 ? titleOnlyMask[index % titleOnlyMask.length] : false;

        const candidates = claims
            .filter((claim) => !usedClaimIds.has(claim.id))
            .sort((left, right) => scoreClaimForRole(right, role) - scoreClaimForRole(left, role));

        let selectedClaim = candidates[0] || null;

        const uncoveredSource = [...requiredPerSource.entries()].find(([, claimId]) => !usedClaimIds.has(claimId));
        if (uncoveredSource) {
            const sourceSpecific = candidates.find((claim) => claim.id === uncoveredSource[1]);
            if (sourceSpecific && (role !== 'cta' || index < screenCount - 1)) {
                selectedClaim = sourceSpecific;
            }
        }

        if (selectedClaim) usedClaimIds.add(selectedClaim.id);

        slidePlan.push({
            slide: index + 1,
            role,
            titleOnly,
            sourceId: selectedClaim?.sourceId || null,
            sourceLabel: selectedClaim?.sourceLabel || null,
            claimId: selectedClaim?.id || null,
            claim: selectedClaim?.text || null,
            requiredAnchors: selectedClaim ? selectRequiredAnchors(selectedClaim, anchorFrequency) : [],
            anchors: selectedClaim
                ? [...selectedClaim.numericAnchors, ...selectedClaim.properNouns, ...selectedClaim.keywordAnchors].slice(0, 6)
                : [],
            noveltyGuard: selectedClaim
                ? `Nao repetir o mesmo enquadramento de ${selectedClaim.sourceLabel}; avance a narrativa com novo detalhe ou nova consequencia e cite pelo menos uma ancora concreta do plano.`
                : 'Introduzir um novo angulo e evitar reformular o slide anterior.',
        });
    }

    return slidePlan;
}

export function buildEvidencePack({
    sources = [],
    imageAnalysis = null,
    context = '',
    blueprint = null,
    contentType = 'sistema',
    screenCount = 8,
    templateSlides = [],
    hasCta = false,
} = {}) {
    const normalizedSources = sources
        .map((source, index) => buildSourceEntry(source, index))
        .filter((source) => source.content);

    if (imageAnalysis) {
        normalizedSources.push(buildSourceEntry({
            id: 'image-analysis',
            type: 'image_analysis',
            label: 'OCR e elementos visuais',
            content: typeof imageAnalysis === 'string' ? imageAnalysis : JSON.stringify(imageAnalysis),
        }, normalizedSources.length));
    }

    if (context && normalizeWhitespace(context).length >= 20) {
        normalizedSources.push(buildSourceEntry({
            id: 'user-context',
            type: 'context',
            label: 'Contexto do usuario',
            content: context,
        }, normalizedSources.length));
    }

    const claims = buildClaimsFromSources(normalizedSources);
    const mustUseClaims = claims.slice(0, Math.min(Math.max(screenCount + 2, 6), 14));
    const slidePlan = buildSlidePlan(mustUseClaims, normalizedSources, {
        screenCount,
        hasCta,
        templateSlides,
    });

    const coverageRules = normalizedSources
        .filter((source) => mustUseClaims.some((claim) => claim.sourceId === source.id))
        .map((source) => `Aproveite pelo menos um detalhe especifico de ${source.label}.`);

    const noveltyGuards = Array.from(new Set([
        'Cada slide precisa acrescentar informacao nova, nao apenas reformular o anterior.',
        'Evite hooks vagos ou frases de efeito sem dado, mecanismo, nome ou consequencia.',
        'Quando existir numero, entidade ou comparacao concreta na fonte, use isso como ancora da copy.',
        ...slidePlan.map((item) => item.noveltyGuard),
    ])).slice(0, 8);

    const narrativeAngles = Array.from(new Set(slidePlan.map((item) => `${item.slide}. ${item.role}: ${item.claim || 'sintese orientada ao proximo passo'}`))).slice(0, screenCount);

    return {
        contentType,
        blueprintSummary: blueprint?.mensagem_principal || blueprint?.tema_central || null,
        sourceCount: normalizedSources.length,
        claimCount: claims.length,
        mustUseClaims,
        supportingClaims: claims.slice(mustUseClaims.length, mustUseClaims.length + 8),
        coverageRules,
        noveltyGuards,
        narrativeAngles,
        slidePlan,
        metadata: {
            sourceLabels: normalizedSources.map((source) => source.label),
            topSignalTags: Array.from(new Set(mustUseClaims.flatMap((claim) => claim.signalTags))).slice(0, 8),
        },
    };
}

export function formatEvidencePackForPrompt(evidencePack) {
    if (!evidencePack) return 'Nenhum pacote de evidencias disponivel.';

    const mustUse = evidencePack.mustUseClaims
        .map((claim, index) => `${index + 1}. [${claim.sourceLabel}] ${claim.text}`)
        .join('\n');

    const coverageRules = evidencePack.coverageRules.map((rule) => `- ${rule}`).join('\n');
    const noveltyGuards = evidencePack.noveltyGuards.map((rule) => `- ${rule}`).join('\n');
    const slidePlan = evidencePack.slidePlan
        .map((item) => {
            const base = `Slide ${item.slide} | papel: ${item.role}`;
            const claim = item.claim ? ` | fato-chave: ${item.claim}` : '';
            const requiredAnchors = item.requiredAnchors?.length ? ` | ancoras obrigatorias: ${item.requiredAnchors.join(', ')}` : '';
            const anchors = item.anchors?.length ? ` | ancoras: ${item.anchors.join(', ')}` : '';
            const titleOnly = item.titleOnly ? ' | slide sem subtitle: o title precisa fechar a ideia inteira' : '';
            return `${base}${claim}${requiredAnchors}${anchors}${titleOnly}`;
        })
        .join('\n');

    return [
        'PACOTE DE EVIDENCIAS (OBRIGATORIO)',
        `- Fontes disponiveis: ${evidencePack.sourceCount}`,
        `- Fatos curados: ${evidencePack.claimCount}`,
        `- Sinal narrativo dominante: ${evidencePack.blueprintSummary || 'nao informado'}`,
        '- Regra inegociavel: cada slide que nao seja CTA deve incorporar pelo menos 1 ancora obrigatoria do plano do proprio slide.',
        '- Se o plano trouxer numero, data, empresa, produto, pessoa ou comparacao concreta, isso precisa aparecer literalmente na copy.',
        '- Antes de responder, valide slide a slide se a ancora obrigatoria realmente apareceu no texto final.',
        '',
        'FATOS QUE DEVEM APARECER NA NARRATIVA:',
        mustUse || '- Nenhum fato curado',
        '',
        'REGRAS DE COBERTURA:',
        coverageRules || '- Sem regras adicionais',
        '',
        'TRAVAS CONTRA RASO E REPETICAO:',
        noveltyGuards || '- Sem travas adicionais',
        '',
        'PLANO DE SLIDES:',
        slidePlan || '- Sem plano disponivel',
    ].join('\n');
}

function collectSlideAnchors(slide) {
    const text = normalizeWhitespace(`${slide?.title || ''} ${slide?.subtitle || ''} ${slide?.content || ''}`);
    return {
        text,
        normalizedText: normalizeKey(text),
        numeric: extractNumericAnchors(text),
        proper: extractProperNouns(text),
        keywords: extractKeywordAnchors(text),
        generic: hasGenericLanguage(text),
        signalTags: buildSignalTags(text),
    };
}

function slideHasAnchor(slideAnchor, anchor) {
    const normalizedAnchor = normalizeKey(anchor);
    if (!normalizedAnchor) return false;

    return slideAnchor.numeric.some((value) => normalizeKey(value) === normalizedAnchor)
        || slideAnchor.proper.some((value) => normalizeKey(value) === normalizedAnchor)
        || slideAnchor.keywords.some((value) => value === normalizedAnchor)
        || slideAnchor.normalizedText.includes(normalizedAnchor);
}

export function analyzeCarouselQuality(slides = [], evidencePack = null) {
    const issues = [];
    const slideAnchors = slides.map((slide, index) => ({ index, ...collectSlideAnchors(slide) }));
    let score = 100;

    for (let index = 0; index < slideAnchors.length; index += 1) {
        const current = slideAnchors[index];
        const next = slideAnchors[index + 1];
        const slidePlan = evidencePack?.slidePlan?.[index] || null;
        const isCta = slidePlan?.role === 'cta';
        const matchedRequiredAnchors = (slidePlan?.requiredAnchors || []).filter((anchor) => slideHasAnchor(current, anchor));

        if (current.generic) {
            issues.push({ type: 'generic_language', slide: index + 1, message: 'Slide com frase vaga ou formulaica.' });
            score -= 8;
        }

        if (!isCta && slidePlan?.requiredAnchors?.length && matchedRequiredAnchors.length === 0) {
            issues.push({
                type: 'missing_planned_anchor',
                slide: index + 1,
                message: `Slide ignora o fato-chave planejado de ${slidePlan.sourceLabel || 'uma fonte importante'}: ${slidePlan.claim || 'sem claim disponivel'}. Inclua pelo menos uma ancora concreta como ${slidePlan.requiredAnchors.join(', ')}.`,
            });
            score -= 16;
        }

        const hardAnchorCount = current.numeric.length + current.proper.length;
        const lacksConcreteSignal = hardAnchorCount === 0
            && !current.signalTags.includes('authority')
            && !current.signalTags.includes('mechanism')
            && !current.signalTags.includes('contrast');
        if (!isCta && lacksConcreteSignal) {
            issues.push({
                type: 'low_specificity',
                slide: index + 1,
                message: 'Slide afirma algo sem nome, numero, comparacao ou mecanismo concreto.',
            });
            score -= 12;
        }

        if (!isCta && matchedRequiredAnchors.length === 1 && hardAnchorCount === 0 && current.keywords.length < 5) {
            issues.push({
                type: 'thin_evidence',
                slide: index + 1,
                message: 'Slide menciona pouco da evidencia planejada e continua abstrato demais.',
            });
            score -= 8;
        }

        if (!slides[index]?.subtitle && current.text.split(' ').length <= 6 && current.numeric.length === 0 && current.proper.length === 0) {
            issues.push({ type: 'weak_title_only', slide: index + 1, message: 'Slide sem subtitle esta curto demais e nao fecha a ideia.' });
            score -= 10;
        }

        if (next) {
            const overlap = jaccardSimilarity(current.keywords, next.keywords);
            if (overlap >= 0.7) {
                issues.push({ type: 'repetition', slide: index + 2, message: 'Slide repete quase o mesmo enquadramento do anterior.' });
                score -= 12;
            }
        }
    }

    if (evidencePack?.mustUseClaims?.length) {
        const allAnchors = new Set(slideAnchors.flatMap((anchor) => [...anchor.numeric, ...anchor.proper, ...anchor.keywords]));
        const missingClaims = evidencePack.mustUseClaims.filter((claim) => {
            const claimAnchors = [...claim.numericAnchors, ...claim.properNouns, ...claim.keywordAnchors].filter(Boolean);
            if (claimAnchors.length === 0) return false;
            const covered = claimAnchors.some((anchor) => allAnchors.has(anchor));
            return !covered;
        });

        if (missingClaims.length > 0) {
            issues.push({
                type: 'unused_evidence',
                slide: null,
                message: `Fatos fortes nao apareceram na copy: ${missingClaims.slice(0, 3).map((claim) => claim.text).join(' | ')}`,
            });
            score -= Math.min(24, missingClaims.length * 5);
        }
    }

    score = Math.max(0, score);

    const repairBrief = issues.length === 0
        ? ''
        : issues.map((issue) => `- ${issue.slide ? `Slide ${issue.slide}` : 'Global'}: ${issue.message}`).join('\n');

    return {
        score,
        passed: score >= 78 && !issues.some((issue) => ['weak_title_only', 'unused_evidence', 'missing_planned_anchor', 'low_specificity'].includes(issue.type)),
        issues,
        repairBrief,
    };
}