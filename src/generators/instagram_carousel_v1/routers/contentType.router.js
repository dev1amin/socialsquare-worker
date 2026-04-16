import { ProductGenerator } from '../generators/product.generator.js';
import { StoryGenerator } from '../generators/story.generator.js';
import { CaseGenerator } from '../generators/case.generator.js';
import { EducationalGenerator } from '../generators/educational.generator.js';
import { SystemGenerator } from '../generators/system.generator.js';
import { logger } from '../../../config/logger.js';

/**
 * Content Type Router: roteia para o gerador apropriado baseado no tipo de conteúdo
 */
export class ContentTypeRouter {
    constructor(tokenTracker) {
        this.tokenTracker = tokenTracker;
        this.generators = {
            produto: new ProductGenerator(tokenTracker),
            historias: new StoryGenerator(tokenTracker),
            cases: new CaseGenerator(tokenTracker),
            educacional: new EducationalGenerator(tokenTracker),
            sistema: new SystemGenerator(tokenTracker),
            system: new SystemGenerator(tokenTracker),
        };
    }

    /**
     * Seleciona e executa o gerador apropriado
     */
    async generate(contentType, blueprint, content, template, input) {
        const generator = this.generators[contentType];

        if (!generator) {
            throw new Error(`Unknown content type: ${contentType}`);
        }

        logger.debug(`Routing to ${contentType} generator`);
        return await generator.generate(blueprint, content, template, input);
    }
}
