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
        /ECONNRESET/i,
        /ETIMEDOUT/i,
        /network/i,
        /rate limit/i,
        /premature close/i,
        /fetch failed/i,
        /socket hang up/i,
        /service unavailable/i,
        /temporarily unavailable/i,
        /connection reset/i,
    ];

    if (error?.retryable === true) {
        return true;
    }

    const errorMessage = error?.message || error?.toString?.() || '';
    return retryablePatterns.some((pattern) => pattern.test(errorMessage));
};

/**
 * Decide se a falha atual já deve ser persistida como definitiva no banco.
 * `attemptsMade` é zero-based no BullMQ, então somamos 1 para obter a tentativa atual.
 */
export const shouldPersistJobFailure = ({ retryable, attemptsMade, maxAttempts }) => {
    const currentAttempt = Math.max(0, Number.parseInt(String(attemptsMade ?? 0), 10) || 0) + 1;
    const totalAttempts = Math.max(1, Number.parseInt(String(maxAttempts ?? 1), 10) || 1);
    return !retryable || currentAttempt >= totalAttempts;
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
