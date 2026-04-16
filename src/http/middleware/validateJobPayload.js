import { ValidationError } from '../../shared/errors.js';

/**
 * Valida payload mínimo do job: { job_id, type, trace_id (optional) }
 * 
 * Suporta também geração com múltiplas fontes:
 * - multiple_links: array de strings (códigos Instagram/URLs adicionais)
 * - multifont: boolean (flag indicando múltiplas fontes)
 */
export const validateJobPayload = (req, res, next) => {
    try {
        const { job_id, type, multiple_links, multifont } = req.body;

        // Validação básica
        if (!job_id || typeof job_id !== 'number') {
            throw new ValidationError('Missing or invalid job_id (must be number)');
        }

        const validTypes = ['instagram_carousel_v1', 'news_carousel_v1'];
        if (!type || !validTypes.includes(type)) {
            throw new ValidationError(`Invalid type (must be one of: ${validTypes.join(', ')})`);
        }

        // Validação de múltiplas fontes (opcional)
        if (multiple_links !== undefined) {
            if (!Array.isArray(multiple_links)) {
                throw new ValidationError('multiple_links must be an array');
            }

            if (multiple_links.length === 0) {
                throw new ValidationError('multiple_links must not be empty');
            }

            // Máximo 5 fontes adicionais
            if (multiple_links.length > 5) {
                throw new ValidationError('multiple_links can have at most 5 items');
            }

            // Todos os itens devem ser strings
            if (!multiple_links.every(item => typeof item === 'string' && item.trim().length > 0)) {
                throw new ValidationError('All items in multiple_links must be non-empty strings');
            }
        }

        // Validação de multifont flag
        if (multifont !== undefined && typeof multifont !== 'boolean') {
            throw new ValidationError('multifont must be a boolean');
        }

        // Se multifont é true, multiple_links deve estar presente
        if (multifont === true && (!multiple_links || multiple_links.length === 0)) {
            throw new ValidationError('If multifont is true, multiple_links must be provided');
        }

        // Se multiple_links está presente, multifont deve ser true
        if (multiple_links && multiple_links.length > 0 && multifont !== true) {
            throw new ValidationError('If multiple_links are provided, multifont must be true');
        }

        next();
    } catch (error) {
        if (error instanceof ValidationError) {
            return res.status(error.statusCode).json({
                error: error.message,
            });
        }
        next(error);
    }
};
