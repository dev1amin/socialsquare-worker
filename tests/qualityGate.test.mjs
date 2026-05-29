import test from 'node:test';
import assert from 'node:assert/strict';

import { assertCarouselQualityPassed } from '../src/generators/shared/utils/qualityGate.js';

test('assertCarouselQualityPassed does not throw for approved quality reports', () => {
    assert.doesNotThrow(() => {
        assertCarouselQualityPassed({
            score: 96,
            passed: true,
            issues: [],
        }, {
            stage: 'final_copy',
        });
    });
});

test('assertCarouselQualityPassed throws when final quality fails', () => {
    assert.throws(() => {
        assertCarouselQualityPassed({
            score: 0,
            passed: false,
            repairBrief: 'Use the source anchors that were planned.',
            issues: [
                { type: 'missing_planned_anchor', slide: 1 },
                { type: 'low_specificity', slide: 2 },
            ],
        }, {
            stage: 'final_copy',
        });
    }, (error) => {
        assert.equal(error.stage, 'quality_gate');
        assert.equal(error.qualityStage, 'final_copy');
        assert.equal(error.score, 0);
        assert.equal(error.issues.length, 2);
        assert.match(error.message, /final_copy/i);
        assert.match(error.message, /missing_planned_anchor/i);
        return true;
    });
});