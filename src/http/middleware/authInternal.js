import { config } from '../../config/env.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { logger } from '../../config/logger.js';

/**
 * Middleware para validar requests internos do backend
 * Verifica o header x-worker-secret
 */
export const authInternal = (req, res, next) => {
    try {
        const secret = req.headers['x-worker-secret'];

        if (!secret) {
            throw new UnauthorizedError('Missing x-worker-secret header');
        }

        if (secret !== config.workerSecret) {
            logger.warn('Invalid worker secret attempt');
            throw new UnauthorizedError('Invalid worker secret');
        }

        next();
    } catch (error) {
        if (error instanceof UnauthorizedError) {
            return res.status(error.statusCode).json({
                error: error.message,
            });
        }
        next(error);
    }
};
