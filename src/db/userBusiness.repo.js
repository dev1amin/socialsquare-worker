import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';

/**
 * Repository para carousel.user_business
 */
export class UserBusinessRepository {
    /**
     * Busca dados de negócio do usuário
     * @param {string} userId - ID do usuário
     * @returns {Promise<Object|null>}
     */
    async getByUserId(userId) {
        try {
            const { data, error } = await supabase
                .schema('carousel')
                .from('user_business')
                .select('*')
                .eq('user_id', userId)
                .single();

            if (error) {
                logger.error('Erro ao buscar user_business', { error, userId });
                return null;
            }

            return data;
        } catch (err) {
            logger.error('Exceção ao buscar user_business', { err, userId });
            return null;
        }
    }

    /**
     * Busca dados de negócio por business_id
     * @param {string} businessId - ID do negócio
     * @returns {Promise<Object|null>}
     */
    async getById(businessId) {
        try {
            const { data, error } = await supabase
                .from('user_business')
                .select('*')
                .eq('id', businessId)
                .single();

            if (error) {
                logger.error('Erro ao buscar user_business por ID', { error, businessId });
                return null;
            }

            return data;
        } catch (err) {
            logger.error('Exceção ao buscar user_business por ID', { err, businessId });
            return null;
        }
    }
}

export default new UserBusinessRepository();
