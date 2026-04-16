import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { NotFoundError } from '../shared/errors.js';

/**
 * Busca job do banco por ID
 */
export const getJob = async (jobId) => {
    try {
        logger.debug(`Fetching job ${jobId} from database (schema: carousel, table: generated_content)`);

        const { data, error } = await supabase
            .schema('carousel')
            .from('generated_content')
            .select('id, user_id, business_id, content_id, provider_type, media_type, input, status, dedupe_key')
            .eq('id', jobId)
            .maybeSingle(); // Usa maybeSingle para evitar erro se não encontrar

        if (error) {
            logger.error(`Database error fetching job ${jobId}: ${error.message}`);
            throw error;
        }

        if (!data) {
            throw new NotFoundError(`Job ${jobId} not found`);
        }

        logger.debug(`Retrieved job ${jobId} from DB - Raw data: ${JSON.stringify({
            id: data.id,
            status: data.status,
            user_id: data.user_id,
            business_id: data.business_id
        })}`);

        return data;
    } catch (error) {
        logger.error(`Failed to get job ${jobId}: ${error.message}`);
        throw error;
    }
};

/**
 * Claim atômico: transição queued -> running
 * Retorna true se conseguiu claim, false se já foi claimed
 */
export const claimJob = async (jobId) => {
    try {
        const { data, error } = await supabase
            .schema('carousel')
            .from('generated_content')
            .update({ status: 'running' })
            .eq('id', jobId)
            .eq('status', 'queued') // CAS: só atualiza se status == queued
            .select('id')
            .single();

        if (error) {
            // Se não encontrou linha, retorna false (alguém já claimed)
            if (error.code === 'PGRST116') {
                logger.debug(`Job ${jobId} already claimed or not queued`);
                return false;
            }
            throw error;
        }

        logger.info(`Job ${jobId} claimed successfully`);
        return true;
    } catch (error) {
        logger.error(`Failed to claim job ${jobId}: ${error.message}`);
        throw error;
    }
};

/**
 * Completa job com sucesso
 */
export const completeJob = async (jobId, result, description = null, tokenMetrics = null) => {
    try {
        // Extrai description do result se não foi fornecido separadamente
        // Tenta múltiplos locais possíveis
        const finalDescription = description || result?.description || result?.dados_gerais?.description || null;

        logger.info(`Job ${jobId} description: ${finalDescription ? finalDescription.substring(0, 100) + '...' : 'NULL'}`);

        // Não remove mais a description do result - a API precisa dela
        // Mantém em múltiplos locais para compatibilidade
        const cleanedResult = { ...result };
        
        // Garante que description está na RAIZ do result
        if (finalDescription) {
            cleanedResult.description = finalDescription;
        }
        
        // Garante que description está em dados_gerais também
        if (cleanedResult.dados_gerais && finalDescription) {
            cleanedResult.dados_gerais.description = finalDescription;
        }

        // Log para debug - verificar estrutura do result
        logger.debug(`Job ${jobId} result structure: description=${!!cleanedResult.description}, dados_gerais.description=${!!cleanedResult.dados_gerais?.description}`);

        // Prepara atualização com tokens se fornecidos
        const updatePayload = {
            status: 'completed',
            result: cleanedResult,
            description: finalDescription,
            completed_at: new Date().toISOString(),
        };

        if (tokenMetrics) {
            updatePayload.tokens_input = tokenMetrics.tokens_input || 0;
            updatePayload.tokens_output = tokenMetrics.tokens_output || 0;
            updatePayload.tokens_total = tokenMetrics.tokens_total || 0;
            updatePayload.tokens_by_agent = tokenMetrics.tokens_by_agent || {};
        }

        const { data, error } = await supabase
            .schema('carousel')
            .from('generated_content')
            .update(updatePayload)
            .eq('id', jobId)
            .eq('status', 'running') // Só completa se estiver running
            .select()
            .single();

        if (error) {
            throw error;
        }

        logger.info(`Job ${jobId} completed successfully`);
        return data;
    } catch (error) {
        logger.error(`Failed to complete job ${jobId}: ${error.message}`);
        throw error;
    }
};

/**
 * Marca job como failed
 * Salva erro dentro do result (não temos coluna error)
 */
export const failJob = async (jobId, errorMessage, stage = 'unknown', retryable = false) => {
    try {
        const errorPayload = {
            error: {
                message: errorMessage.substring(0, 500),
                stage,
                retryable,
                timestamp: new Date().toISOString(),
            },
        };

        const { data, error } = await supabase
            .schema('carousel')
            .from('generated_content')
            .update({
                status: 'failed',
                result: errorPayload,
                completed_at: new Date().toISOString(),
            })
            .eq('id', jobId)
            .eq('status', 'running') // Só falha se estiver running
            .select()
            .single();

        if (error) {
            throw error;
        }

        logger.info(`Job ${jobId} marked as failed`);
        return data;
    } catch (error) {
        logger.error(`Failed to fail job ${jobId}: ${error.message}`);
        throw error;
    }
};
