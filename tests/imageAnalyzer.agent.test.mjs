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

async function loadImageAnalyzerAgent(cacheBuster) {
    const modulePath = pathToFileURL(
        path.resolve('src/generators/instagram_carousel_v1/agents/imageAnalyzer.agent.js')
    ).href;

    const { ImageAnalyzerAgent } = await import(`${modulePath}?test=${cacheBuster}`);
    return ImageAnalyzerAgent;
}

test('ImageAnalyzerAgent builds download targets preserving slide order and fallbacks', async () => {
    ensureRequiredEnv();

    const ImageAnalyzerAgent = await loadImageAnalyzerAgent(`targets-${Date.now()}`);
    const agent = new ImageAnalyzerAgent(null);

    const targets = agent._buildDownloadTargets([], {
        sources: {
            shortcode: 'abc123',
            slides: [
                {
                    position: 0,
                    type: 'image',
                    url: 'https://cdn.example.com/primary-1.jpg',
                    thumbnailUrl: 'https://cdn.example.com/thumb-1.jpg',
                    alternativeImageUrls: [
                        'https://cdn.example.com/primary-1.jpg',
                        'https://cdn.example.com/fallback-1.jpg',
                    ],
                },
                {
                    position: 1,
                    type: 'video',
                    url: 'https://cdn.example.com/video-slide-thumb.jpg',
                    thumbnailUrl: 'https://cdn.example.com/video-slide-thumb.jpg',
                },
            ],
        },
        extractedFrames: [
            {
                extractedThumbnailUrl: 'https://cdn.example.com/extracted-video-thumb.jpg',
                thumbnailUrl: 'https://cdn.example.com/original-video-thumb.jpg',
            },
        ],
    });

    assert.equal(targets.length, 2);
    assert.deepEqual(targets[0].candidateUrls, [
        'https://cdn.example.com/primary-1.jpg',
        'https://cdn.example.com/thumb-1.jpg',
        'https://cdn.example.com/fallback-1.jpg',
    ]);
    assert.deepEqual(targets[1].candidateUrls, [
        'https://cdn.example.com/extracted-video-thumb.jpg',
        'https://cdn.example.com/original-video-thumb.jpg',
        'https://cdn.example.com/video-slide-thumb.jpg',
    ]);
});

test('ImageAnalyzerAgent returns placeholders when every image download fails', async () => {
    ensureRequiredEnv();

    const ImageAnalyzerAgent = await loadImageAnalyzerAgent(`all-fail-${Date.now()}`);
    const agent = new ImageAnalyzerAgent(null);

    agent._downloadImageTargets = async () => ([
        { slideNumber: 1, base64: null, errorMessage: 'HTTP 503: Service Unavailable' },
        { slideNumber: 2, base64: null, errorMessage: 'HTTP 503: Service Unavailable' },
    ]);

    const slides = await agent.analyze({
        imageUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        metadata: {},
    });

    assert.equal(slides.length, 2);
    assert.deepEqual(slides.map((slide) => slide.slide), [1, 2]);
    assert.ok(slides.every((slide) => slide.descricao === 'An\u00e1lise visual indispon\u00edvel'));
});

test('ImageAnalyzerAgent falls back to per-slide vision analysis when batch analysis fails', async () => {
    ensureRequiredEnv();

    const ImageAnalyzerAgent = await loadImageAnalyzerAgent(`vision-fallback-${Date.now()}`);
    const agent = new ImageAnalyzerAgent(null);

    agent._downloadImageTargets = async () => ([
        { slideNumber: 1, base64: 'aGVsbG8=' },
        { slideNumber: 2, base64: 'd29ybGQ=' },
    ]);

    let callCount = 0;
    agent._requestVisionAnalysis = async (images, imageCount) => {
        callCount += 1;

        if (imageCount === 2) {
            throw new Error('batch failure');
        }

        const label = callCount === 2 ? 'Primeiro slide' : 'Segundo slide';
        return `slide1 { texto: """${label}""", descricao: "Visual ${callCount}" }`;
    };

    const slides = await agent.analyze({
        imageUrls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
        metadata: {},
    });

    assert.equal(slides.length, 2);
    assert.equal(slides[0].texto, 'Primeiro slide');
    assert.equal(slides[1].texto, 'Segundo slide');
    assert.equal(slides[0].descricao, 'Visual 2');
    assert.equal(slides[1].descricao, 'Visual 3');
});

test('ImageAnalyzerAgent falls back to a secondary candidate URL after repeated 503 responses', async () => {
    ensureRequiredEnv();

    const ImageAnalyzerAgent = await loadImageAnalyzerAgent(`secondary-url-${Date.now()}`);
    const agent = new ImageAnalyzerAgent(null);
    const originalFetch = global.fetch;
    const attemptedUrls = [];

    global.fetch = async (url) => {
        attemptedUrls.push(url);

        if (url.includes('primary.jpg')) {
            return {
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
            };
        }

        return {
            ok: true,
            arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
        };
    };

    try {
        const result = await agent._downloadTargetWithFallbacks({
            slideNumber: 1,
            candidateUrls: [
                'https://cdn.example.com/primary.jpg',
                'https://cdn.example.com/fallback.jpg',
            ],
        }, 1, 1);

        assert.equal(result.downloadedUrl, 'https://cdn.example.com/fallback.jpg');
        assert.equal(result.base64, 'AQIDBA==');
        assert.equal(attemptedUrls.filter((url) => url.includes('primary.jpg')).length, 3);
        assert.equal(attemptedUrls.filter((url) => url.includes('fallback.jpg')).length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});
