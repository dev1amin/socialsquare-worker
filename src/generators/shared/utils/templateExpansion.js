function cloneSlide(slide) {
    return slide && typeof slide === 'object' ? { ...slide } : slide;
}

export function expandTemplateSlides(templateSlides = [], screenCount = templateSlides.length, options = {}) {
    const preserveFinalSlide = options.preserveFinalSlide === true;
    const excludeFinalSlide = options.excludeFinalSlide === true;
    if (!Array.isArray(templateSlides) || templateSlides.length === 0) {
        return [];
    }

    const normalizedScreenCount = Number.isInteger(screenCount) && screenCount > 0
        ? screenCount
        : templateSlides.length;
    const cycleSlides = excludeFinalSlide && templateSlides.length > 1
        ? templateSlides.slice(0, -1)
        : templateSlides;

    if (!preserveFinalSlide) {
        if (cycleSlides.length === 0) {
            return [];
        }

        if (normalizedScreenCount <= cycleSlides.length) {
            return cycleSlides.slice(0, normalizedScreenCount).map(cloneSlide);
        }

        return Array.from({ length: normalizedScreenCount }, (_, index) => cloneSlide(cycleSlides[index % cycleSlides.length]));
    }

    if (normalizedScreenCount <= templateSlides.length) {
        if (normalizedScreenCount === 1) {
            return [cloneSlide(templateSlides[templateSlides.length - 1])];
        }

        return [
            ...templateSlides.slice(0, normalizedScreenCount - 1),
            templateSlides[templateSlides.length - 1],
        ].map(cloneSlide);
    }

    if (templateSlides.length === 1) {
        return Array.from({ length: normalizedScreenCount }, () => cloneSlide(templateSlides[0]));
    }

    const preservedFinalSlide = cloneSlide(templateSlides[templateSlides.length - 1]);
    const reusableSlides = templateSlides.slice(0, -1).map(cloneSlide);
    const repeatTailCount = Math.max(1, Math.min(options.repeatTailCount || 3, reusableSlides.length));
    const repeatPool = reusableSlides.slice(-repeatTailCount);
    const expandedSlides = reusableSlides.slice(0, normalizedScreenCount - 1);

    while (expandedSlides.length < normalizedScreenCount - 1) {
        const repeatIndex = (expandedSlides.length - reusableSlides.length) % repeatPool.length;
        expandedSlides.push(cloneSlide(repeatPool[(repeatIndex + repeatPool.length) % repeatPool.length]));
    }

    expandedSlides.push(preservedFinalSlide);
    return expandedSlides;
}