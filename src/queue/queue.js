import { Queue } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

const connection = createRedisConnection();

export const contentQueue = new Queue(config.queue.name, {
    connection,
    defaultJobOptions: {
        attempts: config.queue.attempts,
        backoff: {
            type: 'exponential',
            delay: config.queue.backoffDelay,
        },
        removeOnComplete: {
            count: 100, // Mantém últimos 100 jobs completados
        },
        removeOnFail: {
            count: 200, // Mantém últimos 200 jobs com falha
        },
    },
});

/**
 * Adiciona job na fila
 * @param {object} data - { job_id, type, trace_id }
 */
export const addJobToQueue = async (data) => {
    try {
        const { job_id, type, trace_id } = data;

        // Usa job_id prefixado para evitar duplicação na fila
        // BullMQ não aceita IDs puramente numéricos, então prefixamos com "job-"
        const job = await contentQueue.add(
            type, // nome do job (instagram_carousel_v1, etc)
            { job_id, type, trace_id },
            {
                jobId: `job-${job_id}`, // ID único do BullMQ = "job-{generated_content.id}"
            }
        );

        logger.info(`Job ${job.id} added to queue (type: ${type})`);
        return job;
    } catch (error) {
        logger.error(`Failed to add job to queue: ${error.message}`);
        throw error;
    }
};
