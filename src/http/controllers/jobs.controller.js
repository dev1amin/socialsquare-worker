import { addJobToQueue } from '../../queue/queue.js';
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
export const healthCheck = (req, res) => {
    res.json({
        status: 'ok',
        service: 'carousel-worker',
        timestamp: new Date().toISOString(),
    });
};
