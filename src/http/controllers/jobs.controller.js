import { addJobToQueue, contentQueue } from '../../queue/queue.js';
import { logger } from '../../config/logger.js';

/**
 * Endpoint para enfileirar job
 * POST /jobs/enqueue
 * 
 * Payload mínimo: { job_id, type, trace_id (optional) }
 */
export const enqueueJob = async (req, res) => {
    try {
        const { job_id, type, trace_id } = req.body;

        logger.info(`Enqueuing job_id ${job_id} (type: ${type}, trace_id: ${trace_id || 'none'})`);

        // Adiciona job na fila com jobId = generated_content.id
        const job = await addJobToQueue({
            job_id,
            type,
            trace_id,
        });

        res.status(202).json({
            success: true,
            job_id: job.id,
            message: 'Job enqueued successfully',
        });
    } catch (error) {
        logger.error(`Error enqueuing job: ${error.message}`);
        res.status(500).json({
            error: 'Failed to enqueue job',
            message: error.message,
        });
    }
};

/**
 * Healthcheck
 */
export const healthCheck = async (req, res) => {
    try {
        // Verifica Redis via ping (BullMQ v5: contentQueue.client é uma Promise)
        let redisStatus = 'unknown';
        try {
            const redisClient = await Promise.race([
                contentQueue.client,
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
            ]);
            await redisClient.ping();
            redisStatus = 'ok';
        } catch (e) {
            redisStatus = `error: ${e.message}`;
        }

        // Contagem de jobs na fila
        const [waiting, active, failed, failedJobs] = await Promise.all([
            contentQueue.getWaitingCount().catch(() => -1),
            contentQueue.getActiveCount().catch(() => -1),
            contentQueue.getFailedCount().catch(() => -1),
            contentQueue.getFailed(0, 2).catch(() => []),
        ]);

        // Últimos erros dos jobs falhos
        const recentErrors = failedJobs.map(j => ({
            id: j.id,
            name: j.name,
            failedReason: j.failedReason,
            attemptsMade: j.attemptsMade,
        }));

        // Variáveis de ambiente presentes
        const envCheck = {
            SUPABASE_URL: !!process.env.SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
            REDIS_URL: !!process.env.REDIS_URL,
            WORKER_SECRET: !!process.env.WORKER_SECRET,
        };

        const healthy = redisStatus === 'ok';

        res.status(healthy ? 200 : 503).json({
            status: healthy ? 'ok' : 'degraded',
            service: 'carousel-worker',
            timestamp: new Date().toISOString(),
            redis: redisStatus,
            queue: {
                name: contentQueue.name,
                waiting,
                active,
                failed,
            },
            recentErrors,
            env: envCheck,
        });
    } catch (err) {
        res.status(503).json({
            status: 'error',
            service: 'carousel-worker',
            timestamp: new Date().toISOString(),
            error: err.message,
        });
    }
};
