import express from 'express';
import { logger } from './config/logger.js';
import jobsRoutes from './http/routes/jobs.routes.js';

const app = express();

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
    logger.http(`${req.method} ${req.path}`);
    next();
});

// Routes
app.use(jobsRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error(`Error: ${err.message}`);

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

export default app;
