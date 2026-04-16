import { createRedisConnection } from '../config/redis.js';
import { logger } from '../config/logger.js';

const redis = createRedisConnection();

/**
 * Serviço de invalidação de cache
 */
export class CacheService {
    /**
     * Invalida cache de um generated_content específico
     */
    async invalidateGeneratedContent(jobId) {
        try {
            const key = `generated_content:id:${jobId}`;
            await redis.del(key);
            logger.debug(`Cache invalidated for ${key}`);
        } catch (error) {
            logger.error(`Failed to invalidate cache for job ${jobId}: ${error.message}`);
            // Não lança erro - cache invalidation é best-effort
        }
    }

    /**
     * Invalida cache de lista por user_id e business_id
     */
    async invalidateList(userId, businessId) {
        try {
            const key = `generated_content:list:${userId}:${businessId}`;
            await redis.del(key);
            logger.debug(`Cache invalidated for ${key}`);
        } catch (error) {
            logger.error(`Failed to invalidate list cache: ${error.message}`);
        }
    }

    /**
     * Invalida tudo relacionado a um job
     */
    async invalidateAll(jobId, userId, businessId) {
        await Promise.all([
            this.invalidateGeneratedContent(jobId),
            this.invalidateList(userId, businessId),
        ]);
    }
}

export const cacheService = new CacheService();
