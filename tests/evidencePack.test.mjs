import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeCarouselQuality, buildEvidencePack } from '../src/generators/shared/utils/evidencePack.js';

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

test('analyzeCarouselQuality flags broken encoding and abstract closing as blocking issues', () => {
    const quality = analyzeCarouselQuality(
        [
            { title: 'Banco Central muda o jogo', subtitle: 'A Selic subiu 2 pontos e encareceu o credito.' },
            { title: 'O caixa sente primeiro', subtitle: 'Empresas menores pagam a conta antes do resto do mercado.' },
            { title: 'NÃ£o basta refletir', subtitle: 'Precisamos acompanhar essa nova era com mais consciencia.' },
        ],
        {
            slidePlan: [
                { role: 'hook' },
                { role: 'proof' },
                { role: 'closing' },
            ],
        },
    );

    assert.equal(quality.passed, false);
    assert.ok(quality.issues.some((issue) => issue.type === 'broken_encoding'));
    assert.ok(quality.issues.some((issue) => issue.type === 'detached_closing'));
});