import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Serviço de gerenciamento de arquivos temporários
 */
export class TempFSService {
    constructor() {
        this.baseDir = config.tempDir;
    }

    /**
     * Cria diretório temporário para um job
     */
    async createJobDir(jobId) {
        const jobDir = path.join(this.baseDir, jobId.toString());
        try {
            await fs.mkdir(jobDir, { recursive: true });
            logger.debug(`Created temp dir: ${jobDir}`);
            return jobDir;
        } catch (error) {
            logger.error(`Failed to create job dir ${jobId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Remove diretório de um job
     */
    async cleanupJob(jobId) {
        const jobDir = path.join(this.baseDir, jobId.toString());
        try {
            await fs.rm(jobDir, { recursive: true, force: true });
            logger.debug(`Cleaned up temp dir: ${jobDir}`);
        } catch (error) {
            logger.error(`Failed to cleanup job dir ${jobId}: ${error.message}`);
            // Não lança erro - cleanup é best-effort
        }
    }

    /**
     * Janitor: remove arquivos antigos (> TTL minutos)
     * Executar no startup do worker
     */
    async janitor() {
        try {
            logger.info('Running temp filesystem janitor...');
            const ttlMs = config.jobTtlMinutes * 60 * 1000;
            const now = Date.now();

            const entries = await fs.readdir(this.baseDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const dirPath = path.join(this.baseDir, entry.name);
                const stats = await fs.stat(dirPath);
                const age = now - stats.mtimeMs;

                if (age > ttlMs) {
                    await fs.rm(dirPath, { recursive: true, force: true });
                    logger.debug(`Janitor removed old dir: ${entry.name} (age: ${Math.round(age / 60000)}min)`);
                }
            }

            logger.info('Janitor completed');
        } catch (error) {
            logger.error(`Janitor error: ${error.message}`);
        }
    }

    /**
     * Inicializa o diretório base
     */
    async init() {
        try {
            await fs.mkdir(this.baseDir, { recursive: true });
            logger.info(`Temp directory initialized: ${this.baseDir}`);
            await this.janitor();
        } catch (error) {
            logger.error(`Failed to initialize temp directory: ${error.message}`);
            throw error;
        }
    }
}

export const tempfs = new TempFSService();
