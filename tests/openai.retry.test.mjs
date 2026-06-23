import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function ensureRequiredEnv() {
    process.env.SUPABASE_URL ||= 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
    process.env.OPENAI_API_KEY ||= 'test-openai-key';
    process.env.ROCKETAPI_KEY ||= 'test-rocket-key';
    process.env.UNSPLASH_ACCESS_KEY ||= 'test-unsplash-key';
    process.env.OPENAI_CHAT_COMPLETION_ATTEMPTS ||= '4';
    process.env.OPENAI_CHAT_COMPLETION_TIMEOUT_MS ||= '1000';
    process.env.OPENAI_RETRY_BASE_DELAY_MS ||= '1';
    process.env.OPENAI_RETRY_MAX_DELAY_MS ||= '2';
}

async function loadOpenAIConfig(cacheBuster) {
    const modulePath = pathToFileURL(path.resolve('src/config/openai.js')).href;
    return import(`${modulePath}?test=${cacheBuster}`);
}

test('runWithOpenAIRetry retries transient premature close failures', async () => {
    ensureRequiredEnv();

    const { runWithOpenAIRetry } = await loadOpenAIConfig(`retry-success-${Date.now()}`);
    let attempts = 0;

    const result = await runWithOpenAIRetry('unit-test', async () => {
        attempts += 1;

        if (attempts < 3) {
            const error = new Error('Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close');
            error.code = 'ECONNRESET';
            throw error;
        }

        return { ok: true };
    }, { attempts: 4 });

    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 3);
});

test('runWithOpenAIRetry does not retry non-retryable 400 responses', async () => {
    ensureRequiredEnv();

    const { runWithOpenAIRetry } = await loadOpenAIConfig(`retry-fail-${Date.now()}`);
    let attempts = 0;

    await assert.rejects(
        runWithOpenAIRetry('unit-test', async () => {
            attempts += 1;
            const error = new Error('Invalid request');
            error.status = 400;
            throw error;
        }, { attempts: 4 }),
        /Invalid request/,
    );

    assert.equal(attempts, 1);
});

test('isRetryableOpenAIError flags timeout and premature close errors', async () => {
    ensureRequiredEnv();

    const { isRetryableOpenAIError } = await loadOpenAIConfig(`retryable-${Date.now()}`);

    const timeoutError = new Error('Request timed out after 30000ms');
    timeoutError.code = 'ETIMEDOUT';

    const closeError = new Error('Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close');

    assert.equal(isRetryableOpenAIError(timeoutError), true);
    assert.equal(isRetryableOpenAIError(closeError), true);
    assert.equal(isRetryableOpenAIError(new Error('Validation failed')), false);
});
