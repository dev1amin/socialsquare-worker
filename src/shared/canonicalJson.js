/**
 * Converte objeto em JSON canônico (ordenado e determinístico)
 * para garantir que o mesmo payload sempre gere o mesmo hash
 */
export const canonicalJson = (obj) => {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }

    if (Array.isArray(obj)) {
        return '[' + obj.map(canonicalJson).join(',') + ']';
    }

    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
        const value = canonicalJson(obj[key]);
        return `"${key}":${value}`;
    });

    return '{' + pairs.join(',') + '}';
};
