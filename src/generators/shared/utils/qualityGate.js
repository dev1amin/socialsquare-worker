export const BLOCKING_QUALITY_ISSUES = new Set([
    'weak_title_only',
    'unused_evidence',
    'missing_planned_anchor',
    'low_specificity',
    'thin_evidence',
    'weak_hook',
    'bureaucratic_hook',
    'generic_cta',
    'repetition',
    'broken_encoding',
    'detached_closing',
]);

export function countBlockingQualityIssues(qualityReport) {
    const issues = Array.isArray(qualityReport?.issues) ? qualityReport.issues : [];
    return issues.filter((issue) => BLOCKING_QUALITY_ISSUES.has(issue?.type)).length;
}

export function shouldAdoptQualityCandidate(currentReport, candidateReport) {
    if (!candidateReport) {
        return false;
    }

    if (!currentReport) {
        return true;
    }

    if (candidateReport.passed && !currentReport.passed) {
        return true;
    }

    if (!candidateReport.passed && currentReport.passed) {
        return false;
    }

    const currentBlockingIssues = countBlockingQualityIssues(currentReport);
    const candidateBlockingIssues = countBlockingQualityIssues(candidateReport);

    if (candidateBlockingIssues !== currentBlockingIssues) {
        return candidateBlockingIssues < currentBlockingIssues;
    }

    const currentScore = Number(currentReport?.score || 0);
    const candidateScore = Number(candidateReport?.score || 0);
    if (candidateScore !== currentScore) {
        return candidateScore > currentScore;
    }

    const currentIssueCount = Array.isArray(currentReport?.issues) ? currentReport.issues.length : 0;
    const candidateIssueCount = Array.isArray(candidateReport?.issues) ? candidateReport.issues.length : 0;
    if (candidateIssueCount !== currentIssueCount) {
        return candidateIssueCount < currentIssueCount;
    }

    return false;
}

export function cloneSlides(slides = []) {
    return Array.isArray(slides)
        ? slides.map((slide) => (slide && typeof slide === 'object' ? { ...slide } : slide))
        : [];
}

export function mergeCopyIntoDecoratedSlides(copySlides = [], decoratedSlides = []) {
    if (!Array.isArray(copySlides) || !Array.isArray(decoratedSlides) || copySlides.length !== decoratedSlides.length) {
        return cloneSlides(decoratedSlides);
    }

    return decoratedSlides.map((decoratedSlide, index) => {
        const safeDecoratedSlide = decoratedSlide && typeof decoratedSlide === 'object' ? decoratedSlide : {};
        const copySlide = copySlides[index] && typeof copySlides[index] === 'object' ? copySlides[index] : {};

        return {
            ...safeDecoratedSlide,
            title: Object.prototype.hasOwnProperty.call(copySlide, 'title') ? copySlide.title : safeDecoratedSlide.title,
            subtitle: Object.prototype.hasOwnProperty.call(copySlide, 'subtitle') ? copySlide.subtitle : safeDecoratedSlide.subtitle,
            content: Object.prototype.hasOwnProperty.call(copySlide, 'content') ? copySlide.content : safeDecoratedSlide.content,
        };
    });
}

export function assertCarouselQualityPassed(qualityReport, { stage = 'final_copy' } = {}) {
    if (qualityReport?.passed) {
        return qualityReport;
    }

    const issues = Array.isArray(qualityReport?.issues) ? qualityReport.issues : [];
    const topIssue = issues[0]?.type || 'unknown_issue';
    const error = new Error(
        `Carousel quality gate failed at ${stage}: score ${qualityReport?.score ?? 'unknown'} with ${issues.length} issue(s). Top issue: ${topIssue}`,
    );

    error.stage = 'quality_gate';
    error.qualityStage = stage;
    error.score = qualityReport?.score ?? null;
    error.issues = issues;
    error.repairBrief = qualityReport?.repairBrief || '';
    error.retryable = false;

    throw error;
}
