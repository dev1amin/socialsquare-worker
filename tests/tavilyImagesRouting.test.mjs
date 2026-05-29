import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getTavilySearchQuery,
    shouldUseTavilyImageSearch,
} from '../src/generators/shared/utils/imageSearchRouting.js';

test('shouldUseTavilyImageSearch only accepts slides with entity_name', () => {
    assert.equal(
        shouldUseTavilyImageSearch({
            entity_name: 'Agus Panzoni',
            google_keyword: 'Agus Panzoni',
        }),
        true,
    );

    assert.equal(
        shouldUseTavilyImageSearch({
            google_keyword: 'intellectualism trend',
        }),
        false,
    );

    assert.equal(
        shouldUseTavilyImageSearch({
            entity_name: '   ',
            google_keyword: 'Donald Trump',
        }),
        false,
    );
});

test('getTavilySearchQuery returns the trimmed entity_name and ignores google_keyword-only slides', () => {
    assert.equal(
        getTavilySearchQuery({
            entity_name: '  MC Ryan SP  ',
            google_keyword: 'MC Ryan SP',
        }),
        'MC Ryan SP',
    );

    assert.equal(
        getTavilySearchQuery({
            google_keyword: 'Donald Trump',
        }),
        null,
    );
});