import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEvidencePack } from '../src/generators/shared/utils/evidencePack.js';

test('buildEvidencePack ignores Instagram metadata wrappers as narrative claims', () => {
    const evidencePack = buildEvidencePack({
        sources: [
            {
                id: 'instagram-DXpWw_tD2Kq',
                type: 'instagram',
                label: 'Instagram DXpWw_tD2Kq',
                content: `[CONTEÚDO PRINCIPAL INSTAGRAM]\nCriador: @deathtostock (DEATH TO STOCK)\nTipo de mídia: carousel / carousel_container\nSlides: 15 (8 imagens, 7 vídeos)\n\nLegenda:\nThinking is so in. DTS Head of Culture Strategy Agus Panzoni spoke with Markiel Magsalin about intellectualism's recent rise to popularity online.`,
            },
        ],
        screenCount: 3,
        hasCta: false,
    });

    assert.equal(
        evidencePack.mustUseClaims.some((claim) => /CONTEÚDO PRINCIPAL INSTAGRAM|Criador:|Tipo de mídia|Slides: 15/i.test(claim.text)),
        false,
    );
    assert.equal(
        evidencePack.mustUseClaims.some((claim) => /Agus Panzoni|intellectualism|Thinking is so in/i.test(claim.text)),
        true,
    );
});