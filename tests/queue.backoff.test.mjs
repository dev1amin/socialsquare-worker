import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadBackoffUtils(cacheBuster) {
    const modulePath = pathToFileURL(path.resolve('src/queue/utils/backoff.js')).href;
    return import(`${modulePath}?test=${cacheBuster}`);
}

test('isRetryableError treats premature close and explicit retryable flags as transient', async () => {
    const { isRetryableError } = await loadBackoffUtils(`retryable-${Date.now()}`);

    assert.equal(
        isRetryableError(new Error('Invalid response body while trying to fetch https://api.openai.com/v1/chat/completions: Premature close')),
        true,
    );
    assert.equal(
        isRetryableError({ message: 'validation failed', retryable: true }),
        true,
    );
    assert.equal(isRetryableError(new Error('schema validation failed')), false);
});

test('shouldPersistJobFailure waits until the final retryable attempt', async () => {
    const { shouldPersistJobFailure } = await loadBackoffUtils(`persist-${Date.now()}`);

    assert.equal(
        shouldPersistJobFailure({ retryable: true, attemptsMade: 0, maxAttempts: 2 }),
        false,
    );
    assert.equal(
        shouldPersistJobFailure({ retryable: true, attemptsMade: 1, maxAttempts: 2 }),
        true,
    );
    assert.equal(
        shouldPersistJobFailure({ retryable: false, attemptsMade: 0, maxAttempts: 2 }),
        true,
    );
});
