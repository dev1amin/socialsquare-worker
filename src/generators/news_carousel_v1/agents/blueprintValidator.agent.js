import { openai } from '../../../config/openai.js';
import { config } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { PromptLoader } from '../utils/promptLoader.js';
import { recordTokens } from '../../../shared/tokenUtils.js';

/**
 * Blueprint Validator Agent: valida e corrige o blueprint de 42 chaves
 * Garante que todos os campos seguem as microgramáticas
 */
export class BlueprintValidatorAgent {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
    }

    async validate(blueprint) {
        try {
            const { system, user } = await PromptLoader.loadBoth('blueprintValidator', {
                blueprint_json: JSON.stringify(blueprint, null, 2),
            });

            const completion = await openai.chat.completions.create({
                model: config.openai.model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.5,
            });

            // Registra tokens
            if (this.tokenTracker) {
                recordTokens(this.tokenTracker, 'blueprint_validator', completion);
            }

            const validated = JSON.parse(completion.choices[0].message.content);
            logger.debug('Blueprint validated and corrected');

            return validated;
        } catch (error) {
            const err = new Error(`Blueprint validation failed: ${error.message}`);
            err.stage = 'blueprint_validator';
            err.retryable = error.code === 'rate_limit_exceeded';
            throw err;
        }
    }
}
