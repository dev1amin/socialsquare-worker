import Redis from 'ioredis';
import { config } from './env.js';
import { logger } from './logger.js';

export const createRedisConnection = () => {
    const redis = new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
    });

    redis.on('connect', () => {
        logger.info('Redis connected');
    });

    redis.on('error', (err) => {
        logger.error(`Redis error: ${err.message}`);
    });

    return redis;
};
