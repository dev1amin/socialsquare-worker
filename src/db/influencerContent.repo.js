import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { NotFoundError } from '../shared/errors.js';

/**
 * Busca post referência (influencer_content) por ID
 * Nota: contentId é um texto completo (ex: "infl__1234567890")
 * A tabela influencer_content agora usa text como tipo de ID
 */
export const getContentById = async (contentId) => {
    try {
        if (!contentId) {
            throw new Error(`Content ID is required but was not provided`);
        }

        logger.debug(`Fetching content with ID: "${contentId}"`);

        const { data, error } = await supabase
            .from('influencer_content')
            .select('id, code, text, content_url, platform, media_type')
            .eq('id', contentId)
            .maybeSingle();

        if (error) {
            logger.error(`Database error fetching content ${contentId}: ${error.message}`);
            throw error;
        }

        if (!data) {
            throw new NotFoundError(`Content ${contentId} not found`);
        }

        if (!data.code) {
            throw new Error(`Content ${contentId} has no code (consistency error)`);
        }

        logger.debug(`Retrieved content ${contentId} (code: ${data.code})`);
        return data;
    } catch (error) {
        logger.error(`Failed to get content ${contentId}: ${error.message}`);
        throw error;
    }
};
