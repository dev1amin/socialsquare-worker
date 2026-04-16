import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';
import { NotFoundError } from '../shared/errors.js';

/**
 * Busca notícia por ID da tabela public.news
 * Nota: newsId é um texto completo (ex: "gnews__1763584687843")
 * A tabela news agora usa text como tipo de ID
 */
export const getNewsById = async (newsId) => {
    try {
        if (!newsId) {
            throw new Error(`News ID is required but was not provided`);
        }

        logger.debug(`Fetching news with ID: "${newsId}"`);

        const { data, error } = await supabase
            .from('news')
            .select('id, url, title, description, content')
            .eq('id', newsId)
            .maybeSingle();

        if (error) {
            logger.error(`Database error fetching news ${newsId}: ${error.message}`);
            throw error;
        }

        if (!data) {
            throw new NotFoundError(`News ${newsId} not found`);
        }

        if (!data.url) {
            throw new Error(`News ${newsId} has no URL (consistency error)`);
        }

        logger.debug(`Retrieved news ${newsId} (url: ${data.url})`);
        return data;
    } catch (error) {
        logger.error(`Failed to get news ${newsId}: ${error.message}`);
        throw error;
    }
};
