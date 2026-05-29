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

    throw error;
}