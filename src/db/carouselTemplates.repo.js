import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';

/**
 * Repository para carousel.templates
 */
export class CarouselTemplatesRepository {
    /**
     * Busca template por nome
     * @param {string} templateName - Nome do template (ex: "Template 8")
     * @returns {Promise<Object|null>}
     */
    async getByName(templateName) {
        try {
            const { data, error } = await supabase
                .schema('carousel')
                .from('carousel_templates')
                .select('*')
                .eq('name', templateName)
                .single();

            if (error) {
                logger.error('Erro ao buscar template', { error, templateName });
                return null;
            }

            return data;
        } catch (err) {
            logger.error('Exceção ao buscar template', { err, templateName });
            return null;
        }
    }

    /**
     * Busca template por ID
     * @param {string} templateId - ID do template
     * @returns {Promise<Object|null>}
     */
    async getById(templateId) {
        try {
            const { data, error } = await supabase
                .schema('carousel')
                .from('carousel_templates')
                .select('*')
                .eq('id', templateId)
                .single();

            if (error) {
                logger.error('Erro ao buscar template por ID', { error, templateId });
                return null;
            }

            return data;
        } catch (err) {
            logger.error('Exceção ao buscar template por ID', { err, templateId });
            return null;
        }
    }
}

export default new CarouselTemplatesRepository();
