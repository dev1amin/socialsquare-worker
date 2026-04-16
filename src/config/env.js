import dotenv from 'dotenv';

dotenv.config();

export const config = {
    // Environment
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3001,
    workerSecret: process.env.WORKER_SECRET,

    // Redis
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },

    // Supabase
    supabase: {
        url: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },

    // Queue
    queue: {
        name: process.env.QUEUE_NAME || 'generated-content',
        concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
        attempts: parseInt(process.env.JOB_ATTEMPTS || '2'),
        backoffDelay: parseInt(process.env.JOB_BACKOFF_DELAY || '10000'),
    },

    // OpenAI
    openai: {
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    },

    // RocketAPI
    rocketapi: {
        key: process.env.ROCKETAPI_KEY,
    },

    // Unsplash
    unsplash: {
        accessKey: process.env.UNSPLASH_ACCESS_KEY,
        appName: process.env.UNSPLASH_APP_NAME || 'carousel_worker',
    },

    // Google Custom Search (Images)
    googleImages: {
        apiKey: process.env.GOOGLE_IMAGES_API_KEY,
        searchEngineId: process.env.GOOGLE_IMAGES_CX,
    },

    // Temp Storage
    tempDir: process.env.TEMP_DIR || '/tmp/carousel',
    jobTtlMinutes: parseInt(process.env.JOB_TTL_MINUTES || '60'),

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
};

// Validação de configs obrigatórias
const required = [
    'supabase.url',
    'supabase.serviceRoleKey',
    'openai.apiKey',
    'rocketapi.key',
    'unsplash.accessKey',
];

for (const key of required) {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
        value = value[k];
    }
    if (!value) {
        throw new Error(`Missing required config: ${key}`);
    }
}
