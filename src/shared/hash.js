import crypto from 'crypto';

/**
 * Gera hash SHA-256 de uma string
 */
export const hashString = (str) => {
    return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Gera hash para dedupe (usado no backend)
 */
export const generateDedupeKey = (canonicalPayload, version = 'v1') => {
    const combined = `${canonicalPayload}:${version}`;
    return hashString(combined);
};
