import test from 'node:test';
import assert from 'node:assert/strict';

import {
    sanitizeCarouselDescription,
    sanitizeCarouselSlides,
    sanitizeGeneratedText,
} from '../src/generators/shared/utils/carouselText.js';

test('sanitizeGeneratedText repairs common mojibake sequences', () => {
    assert.equal(
        sanitizeGeneratedText('A frase resume a virada: repertÃ³rio saiu do nicho.'),
        'A frase resume a virada: repertório saiu do nicho.',
    );
});

test('sanitizeCarouselSlides preserves extra fields while fixing text', () => {
    const [slide] = sanitizeCarouselSlides([
        {
            title: 'NÃ£o é só estética',
            subtitle: 'É capital cultural em circulaÃ§Ã£o.',
            keyword: 'capital cultural',
            imagem_fundo: 'https://example.com/image.jpg',
        },
    ]);

    assert.equal(slide.title, 'Não é só estética');
    assert.equal(slide.subtitle, 'É capital cultural em circulação.');
    assert.equal(slide.keyword, 'capital cultural');
    assert.equal(slide.imagem_fundo, 'https://example.com/image.jpg');
});

test('sanitizeCarouselDescription leaves already-correct PT-BR text untouched', () => {
    const description = 'É isso que está por trás da alta do intelectualismo online.';
    assert.equal(sanitizeCarouselDescription(description), description);
});