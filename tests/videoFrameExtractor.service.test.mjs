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

test('extractFrames limits concurrent extraction calls', async () => {
    ensureRequiredEnv();

    const modulePath = pathToFileURL(
        path.resolve('src/services/videoFrameExtractor.service.js')
    ).href;
    const { videoFrameExtractorService } = await import(`${modulePath}?test=${Date.now()}`);
    const originalExtractFrame = videoFrameExtractorService.extractFrame;

    let inFlight = 0;
    let maxInFlight = 0;

    videoFrameExtractorService.extractFrame = async ({ videoUrl, thumbnailUrl }) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);

        await new Promise((resolve) => setTimeout(resolve, 10));

        inFlight -= 1;
        return {
            videoUrl: `processed:${videoUrl}`,
            thumbnailUrl: `processed:${thumbnailUrl}`,
        };
    };

    try {
        const slides = Array.from({ length: 5 }, (_, index) => ({
            videoUrl: `video-${index}`,
            thumbnailUrl: `thumb-${index}`,
        }));

        const results = await videoFrameExtractorService.extractFrames(slides);

        assert.equal(results.length, slides.length);
        assert.ok(maxInFlight <= 2, `expected max concurrency <= 2, got ${maxInFlight}`);
    } finally {
        videoFrameExtractorService.extractFrame = originalExtractFrame;
    }
});

test('extractFrames preserves the original thumbnail when extraction fails', async () => {
    ensureRequiredEnv();

    const modulePath = pathToFileURL(
        path.resolve('src/services/videoFrameExtractor.service.js')
    ).href;
    const { videoFrameExtractorService } = await import(`${modulePath}?test=fallback-${Date.now()}`);
    const originalExtractFrame = videoFrameExtractorService.extractFrame;

    videoFrameExtractorService.extractFrame = async () => ({
        videoUrl: null,
        thumbnailUrl: null,
    });

    try {
        const [result] = await videoFrameExtractorService.extractFrames([
            {
                position: 0,
                videoUrl: 'video-0',
                thumbnailUrl: 'thumb-0',
            },
        ]);

        assert.equal(result.extractedThumbnailUrl, 'thumb-0');
    } finally {
        videoFrameExtractorService.extractFrame = originalExtractFrame;
    }
});