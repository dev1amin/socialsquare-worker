import app from './app.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';

const PORT = config.port;

app.listen(PORT, () => {
    logger.info(`🚀 Worker HTTP server running on port ${PORT}`);
    logger.info(`Environment: ${config.nodeEnv}`);
});
