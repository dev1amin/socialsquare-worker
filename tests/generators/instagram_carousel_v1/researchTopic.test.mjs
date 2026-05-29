import test from 'node:test';
import assert from 'node:assert/strict';

import { pickResearchTopic } from '../../../src/generators/instagram_carousel_v1/utils/researchTopic.js';

test('pickResearchTopic prefers the caption when context only contains auto instructions', () => {
    const topic = pickResearchTopic({
        userContext: 'INSTRUÇÃO IMPORTANTE: A descrição (legenda) do post NÃO deve conter menções a perfis (@username). Escreva a descrição sem citar @ de nenhuma conta ou página.',
        firstCaption: 'Thinking is so in. DTS Head of Culture Strategy Agus Panzoni spoke with Markiel Magsalin about intellectualism\'s recent rise to popularity online.',
        businessObjective: 'Validar pipeline completo do worker com shortcode real do Instagram.',
        businessName: 'Copilot Test Business',
    });

    assert.equal(
        topic,
        'Thinking is so in. DTS Head of Culture Strategy Agus Panzoni spoke with Markiel Magsalin about intellectualism\'s recent rise to popularity online.',
    );
});

test('pickResearchTopic strips auto instructions but keeps explicit user guidance', () => {
    const topic = pickResearchTopic({
        userContext: 'Quero explorar por que o intelectualismo virou um sinal cultural nas redes.\n\nINSTRUÇÃO IMPORTANTE: A descrição (legenda) do post NÃO deve conter menções a perfis (@username).',
        firstCaption: 'Thinking is so in.',
        businessObjective: 'Validar pipeline completo do worker com shortcode real do Instagram.',
        businessName: 'Copilot Test Business',
    });

    assert.equal(
        topic,
        'Quero explorar por que o intelectualismo virou um sinal cultural nas redes.',
    );
});