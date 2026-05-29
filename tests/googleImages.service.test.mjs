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
}

test('google images service imports without missing env export', async () => {
    ensureRequiredEnv();

    const modulePath = pathToFileURL(
        path.resolve('src/services/googleImages.service.js')
    ).href;
    const module = await import(`${modulePath}?test=${Date.now()}`);

    assert.ok(module.googleImagesService, 'expected googleImagesService export');
    assert.equal(typeof module.googleImagesService.isConfigured, 'function');
});