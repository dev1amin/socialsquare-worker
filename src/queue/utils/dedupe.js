import { canonicalJson } from '../../shared/canonicalJson.js';
import { generateDedupeKey } from '../../shared/hash.js';

/**
 * Calcula dedupe key para um payload
 * (Usado no backend, mas mantido aqui para referência)
 */
export const calculateDedupeKey = (payload, version = 'v1') => {
    const canonical = canonicalJson(payload);
    return generateDedupeKey(canonical, version);
};

/**
 * Extrai campos relevantes para dedupe
 */
export const extractDedupeFields = (type, payload) => {
    switch (type) {
        case 'instagram':
            return {
                type,
                topic: payload.topic,
                style: payload.style,
                // outros campos relevantes
            };

        case 'news':
            return {
                type,
                topic: payload.topic,
                sources: payload.sources,
                // outros campos relevantes
            };

        default:
            return payload;
    }
};
