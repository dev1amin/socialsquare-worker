/**
 * Carousel Worker SDK
 * SDK simplificado para integração com o Carousel Worker
 * 
 * Uso:
 * ```javascript
 * import { CarouselWorkerClient } from './carousel-worker-sdk.js';
 * 
 * const client = new CarouselWorkerClient({
 *   workerUrl: 'http://localhost:3001',
 *   apiSecret: 'seu-secret',
 *   supabaseUrl: 'https://....supabase.co',
 *   supabaseKey: 'service-role-key'
 * });
 * 
 * const result = await client.generateCarousel({
 *   userId: 'user-uuid',
 *   businessId: 'business-uuid',
 *   code: 'DSHyK_IjvmS',
 *   template: '8',
 *   contentType: 'cases',
 *   screenCount: 10
 * });
 * ```
 */

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

export class CarouselWorkerClient {
    constructor(config) {
        this.workerUrl = config.workerUrl;
        this.apiSecret = config.apiSecret;

        this.supabase = createClient(
            config.supabaseUrl,
            config.supabaseKey
        );
    }

    /**
     * Gera carrossel completo
     * @param {Object} options
     * @param {string} options.userId - UUID do usuário
     * @param {string} options.businessId - UUID do negócio
     * @param {string} options.code - Shortcode do Instagram
     * @param {string} options.template - Número do template (1-10)
     * @param {string} options.contentType - produto | historias | cases | educacional | sistema
     * @param {number} options.screenCount - Número de slides
     * @param {string} [options.context] - Contexto adicional (opcional)
     * @param {boolean} [options.hasCta=false] - Se deve ter CTA
     * @param {string} [options.ctaType] - comentar | salvar | compartilhar | visitar
     * @param {string} [options.ctaIntention] - produto | engajamento | educacional
     * @param {number} [options.timeoutSeconds=120] - Timeout em segundos
     * @returns {Promise<Object>}
     */
    async generateCarousel(options) {
        const {
            userId,
            businessId,
            code,
            template,
            contentType,
            screenCount,
            context,
            hasCta = false,
            ctaType,
            ctaIntention,
            timeoutSeconds = 120
        } = options;

        // Valida campos obrigatórios
        this._validateRequired({ userId, businessId, code, template, contentType, screenCount });

        // 1. Cria job no banco
        const jobId = await this._createJob(userId, businessId, {
            code,
            template,
            content_type: contentType,
            screen_count: screenCount,
            context,
            has_cta: hasCta,
            cta_type: ctaType,
            cta_intention: ctaIntention,
            dimension: '1170x1560',
            description_length: 'curta'
        });

        // 2. Enfileira no worker
        await this._enqueueJob(jobId);

        // 3. Aguarda conclusão
        const result = await this._waitForCompletion(jobId, timeoutSeconds);

        return result;
    }

    /**
     * Enfileira job já existente no banco
     * @param {string} jobId - UUID do job
     * @returns {Promise<void>}
     */
    async enqueueExistingJob(jobId) {
        await this._enqueueJob(jobId);
    }

    /**
     * Verifica status de um job
     * @param {string} jobId - UUID do job
     * @returns {Promise<Object>}
     */
    async getJobStatus(jobId) {
        const { data, error } = await this.supabase
            .schema('carousel')
            .from('generated_content')
            .select('id, status, result, error, created_at, updated_at')
            .eq('id', jobId)
            .single();

        if (error) throw error;

        return {
            jobId: data.id,
            status: data.status,
            result: data.result,
            error: data.error,
            createdAt: data.created_at,
            updatedAt: data.updated_at
        };
    }

    /**
     * Cancela job (marca como failed)
     * @param {string} jobId - UUID do job
     * @returns {Promise<void>}
     */
    async cancelJob(jobId) {
        const { error } = await this.supabase
            .schema('carousel')
            .from('generated_content')
            .update({
                status: 'failed',
                error: { message: 'Cancelled by user', code: 'USER_CANCELLED' },
                updated_at: new Date().toISOString()
            })
            .eq('id', jobId)
            .eq('status', 'queued'); // Só cancela se ainda estiver queued

        if (error) throw error;
    }

    /**
     * Lista jobs de um usuário
     * @param {string} userId - UUID do usuário
     * @param {Object} [filters] - Filtros adicionais
     * @returns {Promise<Array>}
     */
    async listUserJobs(userId, filters = {}) {
        let query = this.supabase
            .schema('carousel')
            .from('generated_content')
            .select('id, status, created_at, updated_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        if (filters.limit) {
            query = query.limit(filters.limit);
        }

        const { data, error } = await query;

        if (error) throw error;

        return data;
    }

    // ========== Métodos Privados ==========

    _validateRequired(fields) {
        const missing = Object.entries(fields)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
    }

    async _createJob(userId, businessId, inputData) {
        const { data, error } = await this.supabase
            .schema('carousel')
            .from('generated_content')
            .insert({
                user_id: userId,
                business_id: businessId,
                input: inputData,
                status: 'queued',
                media_type: 8,
                provider_type: 'carousel-container'
            })
            .select('id')
            .single();

        if (error) {
            throw new Error(`Failed to create job: ${error.message}`);
        }

        return data.id;
    }

    async _enqueueJob(jobId) {
        try {
            const response = await axios.post(
                `${this.workerUrl}/api/v1/jobs/enqueue`,
                {
                    job_id: jobId,
                    type: 'instagram_carousel_v1',
                    trace_id: `sdk-${jobId}-${Date.now()}`
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiSecret}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 5000
                }
            );

            return response.data;
        } catch (error) {
            if (error.response) {
                throw new Error(`Worker API error: ${error.response.data.message || error.message}`);
            }
            throw new Error(`Failed to enqueue job: ${error.message}`);
        }
    }

    async _waitForCompletion(jobId, timeoutSeconds) {
        const maxAttempts = Math.ceil(timeoutSeconds / 2);

        for (let i = 0; i < maxAttempts; i++) {
            const status = await this.getJobStatus(jobId);

            if (status.status === 'completed') {
                return {
                    success: true,
                    jobId: status.jobId,
                    result: status.result,
                    completedAt: status.updatedAt
                };
            }

            if (status.status === 'failed') {
                return {
                    success: false,
                    jobId: status.jobId,
                    error: status.error,
                    failedAt: status.updatedAt
                };
            }

            // Aguarda 2 segundos antes de checar novamente
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        throw new Error(`Job timeout after ${timeoutSeconds}s`);
    }
}

// Export conveniente para uso direto
export default CarouselWorkerClient;
