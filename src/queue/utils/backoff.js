/**
 * Calcula delay para retry com exponential backoff
 */
export const calculateBackoff = (attemptsMade, baseDelay = 5000) => {
    return baseDelay * Math.pow(2, attemptsMade - 1);
};

/**
 * Verifica se erro é recuperável (retry faz sentido)
 */
export const isRetryableError = (error) => {
    // Erros de rede, timeout, etc são recuperáveis
    const retryablePatterns = [
        /timeout/i,
        /ECONNREFUSED/i,
        /ETIMEDOUT/i,
        /network/i,
        /rate limit/i,
    ];

    const errorMessage = error.message || error.toString();
    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
};

/**
 * Verifica se erro é permanente (não adianta retry)
 */
export const isPermanentError = (error) => {
    const permanentPatterns = [
        /validation/i,
        /invalid/i,
        /not found/i,
        /unauthorized/i,
        /forbidden/i,
    ];

    const errorMessage = error.message || error.toString();
    return permanentPatterns.some((pattern) => pattern.test(errorMessage));
};
