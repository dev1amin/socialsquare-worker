import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assertCarouselQualityPassed,
    cloneSlides,
    countBlockingQualityIssues,
    mergeCopyIntoDecoratedSlides,
    shouldAdoptQualityCandidate,
} from '../src/generators/shared/utils/qualityGate.js';

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
        assert.equal(error.retryable, false);
        assert.match(error.message, /final_copy/i);
        assert.match(error.message, /missing_planned_anchor/i);
        return true;
    });
});

test('shouldAdoptQualityCandidate prefers fewer blocking issues over lower-scoring regressions', () => {
    assert.equal(shouldAdoptQualityCandidate({
        score: 96,
        passed: true,
        issues: [],
    }, {
        score: 74,
        passed: false,
        issues: [{ type: 'missing_planned_anchor' }],
    }), false);

    assert.equal(shouldAdoptQualityCandidate({
        score: 58,
        passed: false,
        issues: [
            { type: 'missing_planned_anchor' },
            { type: 'low_specificity' },
            { type: 'weak_hook' },
        ],
    }, {
        score: 82,
        passed: false,
        issues: [{ type: 'weak_hook' }],
    }), true);

    assert.equal(countBlockingQualityIssues({
        issues: [
            { type: 'weak_hook' },
            { type: 'generic_language' },
            { type: 'missing_planned_anchor' },
        ],
    }), 2);
});

test('mergeCopyIntoDecoratedSlides restores copy while preserving decorated image fields', () => {
    const merged = mergeCopyIntoDecoratedSlides([
        { title: 'Novo title', subtitle: 'Novo subtitle', content: 'Nova copy' },
    ], [
        { title: 'Velho title', subtitle: 'Velho subtitle', content: 'Velha copy', imagem_fundo: 'https://img', keyword: 'decorated' },
    ]);

    assert.deepEqual(merged, [{
        title: 'Novo title',
        subtitle: 'Novo subtitle',
        content: 'Nova copy',
        imagem_fundo: 'https://img',
        keyword: 'decorated',
    }]);

    const cloned = cloneSlides(merged);
    assert.notEqual(cloned, merged);
    assert.deepEqual(cloned, merged);
});
