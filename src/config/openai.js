import https from 'node:https';
import OpenAI from 'openai';
import { config } from './env.js';
import { logger } from './logger.js';

const CHAT_COMPLETION_ATTEMPTS = Math.max(
    1,
    Number.parseInt(process.env.OPENAI_CHAT_COMPLETION_ATTEMPTS || '4', 10) || 4,
);
const CHAT_COMPLETION_TIMEOUT_MS = Math.max(
    10000,
    Number.parseInt(process.env.OPENAI_CHAT_COMPLETION_TIMEOUT_MS || '90000', 10) || 90000,
);
const OPENAI_RETRY_BASE_DELAY_MS = Math.max(
    100,
    Number.parseInt(process.env.OPENAI_RETRY_BASE_DELAY_MS || '1000', 10) || 1000,
);
const OPENAI_RETRY_MAX_DELAY_MS = Math.max(
    OPENAI_RETRY_BASE_DELAY_MS,
    Number.parseInt(process.env.OPENAI_RETRY_MAX_DELAY_MS || '8000', 10) || 8000,
);
const OPENAI_FORCE_CONNECTION_CLOSE = process.env.OPENAI_FORCE_CONNECTION_CLOSE !== 'false';
const OPENAI_DISABLE_RESPONSE_COMPRESSION = process.env.OPENAI_DISABLE_RESPONSE_COMPRESSION !== 'false';
const OPENAI_HTTP_MAX_SOCKETS = Math.max(
    1,
    Number.parseInt(process.env.OPENAI_HTTP_MAX_SOCKETS || '20', 10) || 20,
);
const OPENAI_HTTP_SOCKET_TIMEOUT_MS = Math.max(
    CHAT_COMPLETION_TIMEOUT_MS + 1000,
    Number.parseInt(
        process.env.OPENAI_HTTP_SOCKET_TIMEOUT_MS || String(CHAT_COMPLETION_TIMEOUT_MS + 1000),
        10,
    ) || (CHAT_COMPLETION_TIMEOUT_MS + 1000),
);
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
    'ABORT_ERR',
    'ECONNABORTED',
    'ECONNRESET',
    'ECONNREFUSED',
    'ENETDOWN',
    'ENETRESET',
    'ENETUNREACH',
    'EPIPE',
    'ETIMEDOUT',
    'UND_ERR_ABORTED',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_BODY_TIMEOUT',
]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasHeader(headers, name) {
    if (!headers || typeof headers !== 'object') {
        return false;
    }

    const normalized = String(name || '').toLowerCase();
    return Object.keys(headers).some((key) => key.toLowerCase() === normalized);
}

function getRetryDelayMs(error, attempt) {
    const retryAfterMs = Number(error?.headers?.['retry-after-ms'] || 0);
    if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
        return retryAfterMs;
    }

    const retryAfterSeconds = Number(error?.headers?.['retry-after'] || 0);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
    }

    const exponentialDelay = OPENAI_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1));
    return Math.min(OPENAI_RETRY_MAX_DELAY_MS, exponentialDelay);
}

export function isRetryableOpenAIError(error) {
    if (!error) {
        return false;
    }

    const status = Number(error?.status || error?.cause?.status || error?.response?.status || 0);
    const code = String(error?.code || error?.cause?.code || '').toUpperCase();
    const name = String(error?.name || '').toLowerCase();
    const message = String(error?.message || '').toLowerCase();

    if (RETRYABLE_STATUS_CODES.has(status)) {
        return true;
    }

    if (RETRYABLE_ERROR_CODES.has(code)) {
        return true;
    }

    return (
        name.includes('apiconnectionerror')
        || name.includes('apiconnectiontimeouterror')
        || message.includes('premature close')
        || message.includes('fetch failed')
        || message.includes('socket hang up')
        || message.includes('connection error')
        || message.includes('connection reset')
        || message.includes('timed out')
        || message.includes('timeout')
        || message.includes('econnreset')
        || message.includes('etimedout')
        || message.includes('service unavailable')
        || message.includes('temporarily unavailable')
    );
}

function annotateOpenAIError(error, operation, stage = 'openai') {
    if (!error || typeof error !== 'object') {
        return error;
    }

    if (!error.stage) {
        error.stage = stage;
    }

    if (!error.openaiOperation) {
        error.openaiOperation = operation;
    }

    if (isRetryableOpenAIError(error)) {
        error.retryable = true;
    }

    return error;
}

export async function runWithOpenAIRetry(operation, task, options = {}) {
    const attempts = Math.max(1, Number.parseInt(String(options.attempts || CHAT_COMPLETION_ATTEMPTS), 10) || CHAT_COMPLETION_ATTEMPTS);
    const stage = options.stage || 'openai';

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            annotateOpenAIError(error, operation, stage);
            const retryable = isRetryableOpenAIError(error);
            const isLastAttempt = attempt >= attempts;

            if (!retryable || isLastAttempt) {
                throw error;
            }

            const delayMs = getRetryDelayMs(error, attempt);
            logger.warn(`[openai] ${operation} failed (attempt ${attempt}/${attempts}): ${error.message}. Retrying in ${delayMs}ms`);
            await sleep(delayMs);
        }
    }

    throw new Error(`[openai] ${operation} failed without a captured error`);
}

const openAIHttpsAgent = new https.Agent({
    keepAlive: !OPENAI_FORCE_CONNECTION_CLOSE,
    maxSockets: OPENAI_HTTP_MAX_SOCKETS,
    timeout: OPENAI_HTTP_SOCKET_TIMEOUT_MS,
});

function buildOpenAIRequestOptions(options = {}) {
    const headers = {
        ...(options.headers || {}),
    };

    if (OPENAI_DISABLE_RESPONSE_COMPRESSION && !hasHeader(headers, 'accept-encoding')) {
        headers['accept-encoding'] = 'identity';
    }

    if (OPENAI_FORCE_CONNECTION_CLOSE && !hasHeader(headers, 'connection')) {
        headers.connection = 'close';
    }

    return {
        ...options,
        headers,
        httpAgent: options.httpAgent || openAIHttpsAgent,
    };
}

const rawOpenAI = new OpenAI({
    apiKey: config.openai.apiKey,
    maxRetries: 0,
    timeout: CHAT_COMPLETION_TIMEOUT_MS,
    httpAgent: openAIHttpsAgent,
});

const originalCreateChatCompletion = rawOpenAI.chat.completions.create.bind(rawOpenAI.chat.completions);

rawOpenAI.chat.completions.create = async (body, options) => runWithOpenAIRetry(
    `chat.completions.create (${body?.model || 'unknown-model'})`,
    () => originalCreateChatCompletion(body, buildOpenAIRequestOptions(options)),
    { stage: 'openai' },
);

export const openai = rawOpenAI;
