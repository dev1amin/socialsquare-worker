import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getJob, claimJob, completeJob, failJob } from '../db/generatedContent.repo.js';
import { InstagramCarouselOrchestrator } from '../generators/instagram_carousel_v1/orchestrator.js';
import { NewsCarouselOrchestrator } from '../generators/news_carousel_v1/orchestrator.js';
import { cacheService } from '../services/cache.service.js';
import { tempfs } from '../services/tempfs.service.js';
import { createTokenTracker } from '../services/tokenTracker.service.js';
import { flushTokenTracker } from '../services/pricingTracker.service.js';
import { isRetryableError } from './utils/backoff.js';

const connection = createRedisConnection();

/**
 * Processar job com claim atômico e idempotência
 */
const processJob = async (job) => {
    const { job_id, type, trace_id } = job.data;

    logger.info(`🔵 Processing job ${job.id} (job_id: ${job_id}, type: ${type}, trace_id: ${trace_id || 'none'})`);
    logger.debug(`Job data: ${JSON.stringify(job.data)}`);

    let jobData = null;
    let tempDir = null;

    try {
        // 1. Busca job do banco
        jobData = await getJob(job_id);

        logger.debug(`Job ${job_id} current status in DB: "${jobData.status}"`);

        // 2. Verifica status - se já completou ou falhou, ACK e sai
        if (jobData.status === 'completed' || jobData.status === 'failed') {
            logger.warn(`⚠️  Job ${job_id} has status "${jobData.status}" in database - skipping processing. If you want to retry, update status to "queued" in DB first.`);
            return { status: jobData.status, skipped: true };
        }

        // 3. Se está running, ACK e sai (evita duplicar geração)
        if (jobData.status === 'running') {
            logger.info(`Job ${job_id} already running, skipping`);
            return { status: 'running', skipped: true };
        }

        // 4. Claim atômico: queued -> running
        const claimed = await claimJob(job_id);
        if (!claimed) {
            logger.info(`Job ${job_id} was claimed by another worker, skipping`);
            return { status: 'claimed_by_other', skipped: true };
        }

        // 5. Cria diretório temporário
        tempDir = await tempfs.createJobDir(job_id);

        // 6. Criar TokenTracker para rastrear uso de tokens
        const tokenTracker = createTokenTracker(job_id);

        // 7. Roteamento por tipo de geração
        let result;
        switch (type) {
            case 'instagram_carousel_v1':
                const orchestrator = new InstagramCarouselOrchestrator(job_id, trace_id, tokenTracker);
                result = await orchestrator.generate();
                break;

            case 'news_carousel_v1':
                const newsOrchestrator = new NewsCarouselOrchestrator(job_id, trace_id, tokenTracker);
                result = await newsOrchestrator.generate();
                break;

            default:
                throw new Error(`Unknown job type: ${type}`);
        }

        // Log resumido de tokens
        tokenTracker.logSummary();

        // 8. Salva resultado e marca como completed
        await completeJob(job_id, result, null, tokenTracker.getMetrics());

        // 8.1. Pricing: flush dos tokens OpenAI por agent para provider_usage (best-effort)
        await flushTokenTracker({
            jobId: job_id,
            userId: jobData.user_id,
            businessId: jobData.business_id,
            tokenTracker,
        });

        // 9. Invalida cache
        await cacheService.invalidateAll(job_id, jobData.user_id, jobData.business_id);

        logger.info(`Job ${job_id} completed successfully`);
        return { status: 'completed', result };
    } catch (error) {
        logger.error(`Job ${job_id} failed: ${error.message}`);

        const stage = error.stage || 'unknown';
        const retryable = error.retryable !== undefined ? error.retryable : isRetryableError(error);

        // Se esgotou tentativas ou erro não é recuperável, marca como failed
        if (!retryable || job.attemptsMade >= config.queue.attempts) {
            if (jobData) {
                await failJob(job_id, error.message, stage, retryable);
                await cacheService.invalidateAll(job_id, jobData.user_id, jobData.business_id);
            }
        }

        throw error; // BullMQ vai fazer retry se configurado
    } finally {
        // 10. Cleanup SEMPRE acontece
        if (tempDir) {
            await tempfs.cleanupJob(job_id);
        }
    }
};

// Inicializa temp filesystem e roda janitor
await tempfs.init();

// Cria worker
const worker = new Worker(config.queue.name, processJob, {
    connection,
    concurrency: config.queue.concurrency,
    lockDuration: 300000, // 5 minutos (300 segundos) - tempo para processar todo o pipeline
    lockRenewTime: 10000, // Renova lock a cada 10 segundos
});

// Event listeners
worker.on('active', (job) => {
    logger.info(`🔄 Job ${job.id} is now active (started processing)`);
});

worker.on('completed', (job) => {
    logger.info(`✓ Job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
    logger.error(`✗ Job ${job?.id} failed: ${err.message}`);
});

worker.on('error', (err) => {
    logger.error(`Worker error: ${err.message}`);
});

worker.on('ready', () => {
    logger.info(`✅ Worker is ready and waiting for jobs`);
});

worker.on('stalled', (jobId) => {
    logger.warn(`⚠️ Job ${jobId} stalled`);
});

logger.info(`🚀 Worker started`);
logger.info(`   Queue: ${config.queue.name}`);
logger.info(`   Concurrency: ${config.queue.concurrency}`);
logger.info(`   Attempts: ${config.queue.attempts}`);

// Graceful shutdown
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, closing worker...');
    await worker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received, closing worker...');
    await worker.close();
    process.exit(0);
});
