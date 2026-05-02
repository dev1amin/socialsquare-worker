import { logger } from '../../config/logger.js';
import { supabase } from '../../config/supabase.js';
import * as generatedContentRepo from '../../db/generatedContent.repo.js';
import { CarouselTemplatesRepository } from '../../db/carouselTemplates.repo.js';
import { UserBusinessRepository } from '../../db/userBusiness.repo.js';
import * as newsRepo from '../../db/news.repo.js';
import rocketApiClient from '../../services/rocketapi.client.js';
import { htmlScraperService } from '../../services/htmlScraper.service.js';
import { unsplashService } from '../../services/unsplash.service.js';
import { BlueprintGeneratorAgent } from './agents/blueprintGenerator.agent.js';
import { BlueprintValidatorAgent } from './agents/blueprintValidator.agent.js';
import { ContentTypeRouter } from './routers/contentType.router.js';
import { KeywordAgent } from './agents/keyword.agent.js';
import { TitleSquashAgent } from './agents/titleSquash.agent.js';
import { BrandAdapterAgent } from './agents/brandAdapter.agent.js';
import { CTAValidatorAgent } from './agents/ctaValidator.agent.js';
import { DescriptionAgent } from './agents/description.agent.js';
import { trackUsage } from '../../services/pricingTracker.service.js';

/**
 * Orchestrator para geração de carrossel News
 * Pipeline completo baseado no fluxo Instagram, adaptado para notícias:
 * 1. Busca dados do job/template/brand do banco
 * 2. htmlScraper → busca e limpa HTML da notícia (suporta múltiplas URLs)
 * 3. NewsAnalyzer → blueprint 42 chaves a partir do HTML
 * 4. BlueprintValidator → valida/corrige blueprint
 * 5. ContentTypeRouter → roteia para gerador específico
 * 6. KeywordAgent → adiciona keywords para imagens
 * 7. BrandAdapter → adapta ao tom de voz (OPCIONAL)
 * 8. CTAValidator → valida CTA se necessário (OPCIONAL)
 * 9. DescriptionAgent → gera descrição final
 * 
 * NOVO: Suporta geração a partir de múltiplas notícias via:
 * - input.multiple_links: array de URLs adicionais
 * - input.multifont: boolean flag indicando múltiplas fontes
 */
export class NewsCarouselOrchestrator {
    constructor(jobId, traceId, tokenTracker) {
        this.jobId = jobId;
        this.traceId = traceId || `job-${jobId}`;
        this.tokenTracker = tokenTracker;

        // Instanciar repositories
        this.carouselTemplatesRepo = new CarouselTemplatesRepository();
        this.userBusinessRepo = new UserBusinessRepository();

        // Agentes do pipeline
        this.blueprintGenerator = new BlueprintGeneratorAgent(tokenTracker);
        this.blueprintValidator = new BlueprintValidatorAgent(tokenTracker);
        this.router = new ContentTypeRouter(tokenTracker);
        this.keywordAgent = new KeywordAgent(tokenTracker);
        this.titleSquash = new TitleSquashAgent(tokenTracker);
        this.brandAdapter = new BrandAdapterAgent(tokenTracker);
        this.ctaValidator = new CTAValidatorAgent(tokenTracker);
        this.descriptionAgent = new DescriptionAgent(tokenTracker);
    }

    /**
     * Busca dados de múltiplas notícias
     * Continua processando mesmo se alguma falhar
     */
    async fetchMultipleNewsData(urls) {
        const allData = [];

        for (const url of urls) {
            try {
                logger.info(`[${this.traceId}] Scraping news HTML from ${url}...`);
                const htmlText = await htmlScraperService.scrape(url);
                allData.push({
                    url,
                    htmlText
                });
                logger.info(`[${this.traceId}] Successfully scraped news from ${url}`);
            } catch (error) {
                logger.warn(`[${this.traceId}] Failed to scrape news from ${url}: ${error.message}`);
                // Continua com outras URLs, não falha completamente
            }
        }

        if (allData.length === 0) {
            logger.warn(`[${this.traceId}] Failed to scrape any news from ${urls.length} URLs`);
        }

        return allData;
    }

    /**
     * Executa pipeline completo de geração
     * Busca todos os dados necessários do banco e executa o pipeline
     */
    async generate() {
        try {
            logger.info(`[${this.traceId}] Starting news generation for job ${this.jobId}`);

            // ETAPA 1: Buscar job do banco
            logger.info(`[${this.traceId}] Fetching job data from database...`);
            const job = await generatedContentRepo.getJob(this.jobId);

            if (!job) {
                throw new Error(`Job ${this.jobId} not found in database`);
            }

            const input = job.input || job.input_data || {};
            const userId = job.user_id;
            const businessId = job.business_id;
            const contentId = job.content_id;
            this.userId = userId;
            this.businessId = businessId;

            const multifont = input.multifont === true;
            logger.info(`[${this.traceId}] Job loaded: content_type=${input.content_type}, has_context=${!!input.context}, has_cta=${!!input.has_cta}, multifont=${multifont}`);

            // ETAPA 2: Buscar URLs das notícias
            // Prioridade: input.url > contentId do banco
            let newsUrls = [];
            let primaryNewsData = null;
            let newsUrl = input.url; // Primeiro tenta o que foi enviado pelo frontend
            if (!newsUrl && contentId) {
                logger.info(`[${this.traceId}] No URL in input, fetching from content_id ${contentId}...`);
                primaryNewsData = await newsRepo.getNewsById(contentId);
                newsUrl = primaryNewsData.url;
            }

            if (newsUrl) {
                newsUrls.push(newsUrl);
                logger.info(`[${this.traceId}] Primary news URL: ${newsUrl}`);
            } else {
                logger.info(`[${this.traceId}] No primary news URL provided, carousel will be generated without news reference`);
            }

            // Se houver múltiplas fontes, adiciona as outras
            if (multifont && input.multiple_links && Array.isArray(input.multiple_links)) {
                newsUrls.push(...input.multiple_links);
                logger.info(`[${this.traceId}] Multiple news detected. Total URLs: ${newsUrls.length} (primary: ${newsUrl}, additional: ${input.multiple_links.join(', ')})`);
            }

            // ETAPA 3: Buscar template do banco
            logger.info(`[${this.traceId}] Fetching template ${input.template}...`);
            const templateName = `Template ${input.template}`;
            const templateData = await this.carouselTemplatesRepo.getByName(templateName);

            if (!templateData) {
                throw new Error(`Template "${templateName}" not found`);
            }

            // ETAPA 4: Buscar brand data do banco
            logger.info(`[${this.traceId}] Fetching brand data for user ${userId}...`);
            const brandData = await this.userBusinessRepo.getByUserId(userId);

            // ETAPA 4.1: Auto-fetch foto de perfil do próprio usuário se negócio não tem logo
            if (brandData && !brandData.logo_url && brandData.instagram) {
                logger.info(`[${this.traceId}] Business has no logo — fetching profile pic for @${brandData.instagram}`);
                try {
                    const userProfile = await rocketApiClient.getUserProfile(brandData.instagram);
                    trackUsage({
                        jobId: this.jobId,
                        userId: this.userId,
                        businessId: this.businessId,
                        provider: 'rocketapi',
                        operation: 'instagram.get_user_profile',
                        units: 1,
                        metadata: { username: brandData.instagram },
                    });
                    if (userProfile?.profile_pic_url) {
                        const { error } = await supabase
                            .schema('carousel')
                            .from('user_business')
                            .update({ logo_url: userProfile.profile_pic_url })
                            .eq('id', brandData.id);
                        
                        if (!error) {
                            brandData.logo_url = userProfile.profile_pic_url;
                            logger.info(`[${this.traceId}] Profile pic saved for @${brandData.instagram}`);
                        }
                    }
                } catch (err) {
                    logger.warn(`[${this.traceId}] Error fetching user profile pic: ${err.message}`);
                }
            }

            // ETAPA 5: HTML Scraper - busca e limpa HTML das notícias (suporta múltiplas)
            let allNewsData = [];
            if (newsUrls.length > 0) {
                if (multifont && newsUrls.length > 1) {
                    // NOVO: Buscar múltiplas notícias
                    logger.info(`[${this.traceId}] Fetching data from ${newsUrls.length} news URLs...`);
                    allNewsData = await this.fetchMultipleNewsData(newsUrls);
                } else {
                    // Fluxo existente: 1 notícia
                    logger.info(`[${this.traceId}] Scraping news HTML from ${newsUrls[0]}...`);
                    const htmlText = await htmlScraperService.scrape(newsUrls[0]);
                    allNewsData = [{ url: newsUrls[0], htmlText }];
                }
            } else {
                logger.info(`[${this.traceId}] No news URLs available, skipping HTML scraping`);
            }

            // ETAPA 6: Blueprint Generator - gera blueprint narrativo (42 chaves) a partir do HTML
            logger.info(`[${this.traceId}] Running blueprint generator to generate blueprint...`);
            let blueprint;
            if (allNewsData.length > 0) {
                logger.info(`[${this.traceId}] Generating blueprint from ${allNewsData.length} news source(s)...`);
                
                // Para múltiplas fontes, concatena os textos
                const allHtmlText = allNewsData.map(item => item.htmlText).filter(text => text).join('\n---\n');
                
                blueprint = await this.blueprintGenerator.analyze({
                    htmlText: allHtmlText || null,
                    context: input.context,
                    // NOVO: Passa contexto de múltiplas fontes
                    sources: multifont ? allNewsData.map(item => ({
                        url: item.url
                    })) : (allNewsData[0] ? [{ url: allNewsData[0].url }] : []),
                    multifont
                });
            } else {
                logger.info(`[${this.traceId}] No HTML content available, generating blueprint from context only...`);
                blueprint = await this.blueprintGenerator.analyze({
                    htmlText: null,
                    context: input.context,
                    multifont
                });
            }

            // ETAPA 7: Blueprint Validator - valida e corrige blueprint
            logger.info(`[${this.traceId}] Validating blueprint...`);
            const validatedBlueprint = await this.blueprintValidator.validate(blueprint);

            // ETAPA 8: Content Type Router - seleciona e executa gerador apropriado
            logger.info(`[${this.traceId}] Generating slides (content_type: ${input.content_type})...`);
            const htmlContent = allNewsData.length > 0 ? 
                allNewsData.map(item => item.htmlText).join('\n---\n') : 
                null;
            const slides = await this.router.generate(
                input.content_type,
                validatedBlueprint,
                htmlContent,
                templateData,
                { ...input, multifont }
            );

            // ETAPA 8.5: TitleSquash — re-gera titles dos slides sem subtitle no template
            // GPT gerou title+subtitle para todos; aqui reduzimos os slots title-only
            // com uma segunda passagem inteligente (não concatenação mecânica).
            const _baseMask = templateData.slides.map(s => !!s.subtitle);
            const _titleOnlyCount = slides.filter((_, i) => !_baseMask[i % _baseMask.length]).length;
            // Templates com slides de texto puro (sem imagem) que precisam de parágrafos longos
            const LONG_TEXT_SLIDE_CONFIG = {
                'Template 1': new Set([5, 7]),
            };
            const _longTextIndices = LONG_TEXT_SLIDE_CONFIG[templateName] || new Set();
            let processedSlides = slides;
            if (_titleOnlyCount > 0) {
                logger.info(`[${this.traceId}] TitleSquash: re-generating ${_titleOnlyCount} title-only slides...`);
                try {
                    processedSlides = await this.titleSquash.squash(slides, _baseMask, _longTextIndices);
                    logger.info(`[${this.traceId}] TitleSquash: done`);
                } catch (err) {
                    logger.warn(`[${this.traceId}] TitleSquash failed, falling back to concat: ${err.message}`);
                    processedSlides = slides.map((slide, i) => {
                        if (_baseMask[i % _baseMask.length]) return slide;
                        if (!slide.subtitle) return slide;
                        const t = (slide.title || '').trim();
                        const sep = /[.!?:;]$/.test(t) ? ' ' : '. ';
                        return { ...slide, title: [t, slide.subtitle.trim()].filter(Boolean).join(sep), subtitle: undefined };
                    });
                }
            }

            // ETAPA 9: Keyword Agent - adiciona keywords para busca de imagens
            // Pass a snippet of the article text as source_context so the model can extract
            // entity names present in the article but not in the short slide title/subtitle.
            logger.info(`[${this.traceId}] Adding keywords for image search...`);
            const _allHtmlSnippet = allNewsData
                .map(item => item.htmlText || '')
                .join('\n---\n')
                .substring(0, 2500);
            const slidesWithKeywords = await this.keywordAgent.addKeywords(processedSlides, {
                ...input,
                source_context: _allHtmlSnippet || undefined,
                htmlText: _allHtmlSnippet || undefined,
            });

            // ETAPA 9.5: Google Images - busca imagens para entidades famosas (se configurado)
            let slidesForUnsplash = slidesWithKeywords;
            try {
                    const { googleImagesService } = await import('../../services/googleImages.service.js');
                if (googleImagesService.isConfigured()) {
                    const hasGoogleKeywords = slidesWithKeywords.some(s => s.google_keyword);
                    if (hasGoogleKeywords) {
                        logger.info(`[${this.traceId}] Fetching Google Images for famous entities...`);
                        slidesForUnsplash = await googleImagesService.addGoogleImages(slidesWithKeywords);
                        const googleCount = slidesForUnsplash.filter(s => s._googleImageUsed).length;
                        logger.info(`[${this.traceId}] Google Images used for ${googleCount} slides`);
                        const queries = slidesWithKeywords.filter(s => s.google_keyword).length;
                        if (queries > 0) {
                            trackUsage({
                                jobId: this.jobId,
                                userId: this.userId,
                                businessId: this.businessId,
                                provider: 'google_images',
                                operation: 'customsearch',
                                units: queries,
                                metadata: { used: googleCount },
                            });
                        }
                    }
                }
            } catch (err) {
                logger.warn(`[${this.traceId}] Google Images failed, continuing with Unsplash: ${err.message}`);
            }

            // ============================================================
            // ETAPA 9.7 — IMAGENS ESPECIAIS VIA TAVILY (sempre roda)
            // Estratégia: 2 fontes apenas.
            //   1. Tavily  → slide hero (tema_central) + slides com entity_name
            //               (pessoas, notícias recentes, eventos reais)
            //   2. Unsplash → todos os demais slides (garante mix saudável)
            // ============================================================
            logger.info(`[${this.traceId}] [VERSION:img-v5] Starting Tavily image fill...`);
            try {
                const { searchPersonImages } = await import('../../services/tavily-images.service.js');

                // Query Tavily com o assunto central (1 chamada apenas para o slide hero)
                const subjectQuery = (
                    validatedBlueprint?.tema_central ||
                    validatedBlueprint?.mensagem_principal ||
                    ''
                ).trim();

                const isFilled = (s) => Boolean(s && (s._tavilyImageUsed || s._googleImageUsed));

                // 1) Slide hero (índice 0): usa o tema_central para buscar imagem do assunto real
                if (subjectQuery && slidesForUnsplash[0] && !isFilled(slidesForUnsplash[0])) {
                    logger.info(`[${this.traceId}] Tavily hero query: "${subjectQuery}"`);
                    try {
                        const r = await searchPersonImages(subjectQuery, { appendPhoto: false });
                        if (r?.imagem_fundo) {
                            slidesForUnsplash[0] = {
                                ...slidesForUnsplash[0],
                                imagem_fundo: r.imagem_fundo,
                                imagem_fundo2: r.imagem_fundo2,
                                imagem_fundo3: r.imagem_fundo3,
                                image_source: 'tavily-subject',
                                _tavilyImageUsed: true,
                            };
                            logger.info(`[${this.traceId}] Tavily hero fill: OK`);
                        }
                    } catch (err) {
                        logger.warn(`[${this.traceId}] Tavily hero search failed: ${err.message}`);
                    }
                }

                // 2) Slides com entity_name: busca Tavily pelo nome literal da entidade
                const entitySlides = slidesForUnsplash
                    .map((s, idx) => ({ s, idx }))
                    .filter(({ s, idx }) => {
                        if (idx === 0) return false; // hero já tratado acima
                        if (isFilled(s)) return false;
                        return (s.entity_name && s.entity_name.trim()) ||
                               (s.google_keyword && s.google_keyword.trim());
                    });

                if (entitySlides.length > 0) {
                    logger.info(`[${this.traceId}] Filling ${entitySlides.length} entity slides via Tavily...`);
                    const usedUrls = new Set(
                        slidesForUnsplash.map(s => s.imagem_fundo).filter(Boolean)
                    );
                    const results = await Promise.all(
                        entitySlides.map(({ s }) => {
                            const query = (s.entity_name && s.entity_name.trim())
                                ? s.entity_name.trim()
                                : s.google_keyword.trim();
                            return searchPersonImages(query, { appendPhoto: false });
                        })
                    );
                    let tavilyKwUsed = 0;
                    entitySlides.forEach(({ idx }, i) => {
                        const r = results[i];
                        if (r?.imagem_fundo && !usedUrls.has(r.imagem_fundo)) {
                            usedUrls.add(r.imagem_fundo);
                            slidesForUnsplash[idx] = {
                                ...slidesForUnsplash[idx],
                                imagem_fundo: r.imagem_fundo,
                                imagem_fundo2: r.imagem_fundo2,
                                imagem_fundo3: r.imagem_fundo3,
                                tavily_attributions: r.tavily_attributions,
                                image_source: 'tavily-entity',
                                _tavilyImageUsed: true,
                            };
                            tavilyKwUsed++;
                        }
                        // Sem resultado → slide fica sem _tavilyImageUsed e cai no Unsplash
                    });
                    logger.info(`[${this.traceId}] Tavily-entity filled ${tavilyKwUsed}/${entitySlides.length} slides`);
                }
                // Slides sem entity_name → vão para o Unsplash (ETAPA 10), garantindo mix
            } catch (err) {
                logger.warn(`[${this.traceId}] Tavily image fill failed: ${err.message}`, { stack: err.stack });
            }

            // ETAPA 10: Unsplash - busca imagens de fundo (pula slides que já têm Google Image)
            logger.info(`[${this.traceId}] Fetching background images from Unsplash...`);
            const slidesWithImages = await unsplashService.addBackgroundImages(slidesForUnsplash);

            // ETAPA 10.5: Unsplash Compliance - trigger downloads para imagens usadas
            logger.info(`[${this.traceId}] Triggering Unsplash downloads for compliance...`);
            const slidesWithDownloads = await unsplashService.triggerDownloadsForSlides(slidesWithImages);

            // ETAPA 11: Brand Adapter - adapta ao tom de voz (OPCIONAL - só se tiver context)
            let adaptedSlides = slidesWithDownloads;
            if (input.context && brandData) {
                logger.info(`[${this.traceId}] Adapting to brand voice...`);
                adaptedSlides = await this.brandAdapter.adapt({
                    slides: slidesWithDownloads,
                    brandData,
                    context: input.context,
                    multifont
                });
            } else {
                logger.info(`[${this.traceId}] Skipping brand adaptation (no context or brand data)`);
            }

            // ETAPA 12: CTA Validator - valida/adiciona CTA (OPCIONAL - só se has_cta=true)
            if (input.has_cta) {
                logger.info(`[${this.traceId}] Validating CTA...`);
                adaptedSlides = await this.ctaValidator.ensureCTA(adaptedSlides, input, validatedBlueprint);
            } else {
                logger.info(`[${this.traceId}] Skipping CTA validation (has_cta=false)`);
            }

            // ETAPA 13: Description Agent - gera descrição final do carrossel
            logger.info(`[${this.traceId}] Generating carousel description...`);
            const description = await this.descriptionAgent.generate({
                slides: adaptedSlides,
                brandData,
                context: input.context,
                descriptionLength: input.description_length,
                multifont,
                // NOVO: Passa lista de URLs para descrição
                sourcesUrls: newsUrls
            });

            // ETAPA 14: Monta resultado final
            const result = this.buildFinalResult(
                adaptedSlides,
                description,
                validatedBlueprint,
                allNewsData,
                brandData,
                input,
                userId,
                businessId,
                newsUrls
            );

            logger.info(`[${this.traceId}] News generation completed successfully (${adaptedSlides.length} slides, ${newsUrls.length} source(s))`);
            return result;
        } catch (error) {
            logger.error(`[${this.traceId}] News generation failed: ${error.message}`, {
                stack: error.stack,
                stage: error.stage || 'orchestrator'
            });
            throw error;
        }
    }

    /**
     * Monta resultado final no schema padronizado
     * Segue formato do Instagram com adaptações para News
     * 
     * ⚠️ UNSPLASH COMPLIANCE: Inclui atribuições completas para cada imagem
     * ⚠️ MÚLTIPLAS FONTES: Inclui informação de todas as fontes no metadata
     */
    buildFinalResult(slides, description, blueprint, allNewsData, brandData, input, userId, businessId, allUrls) {
        const multifont = input.multifont === true;
        
        return {
            dados_gerais: {
                nome: brandData?.name || 'Unknown',
                arroba: brandData?.instagram || '',
                foto_perfil: brandData?.logo_url || '',
                template: input.template,
                description,
                // NOVO: Indicar se foi gerado a partir de múltiplas fontes
                multifont,
                sources: multifont ? allUrls : [input.url]
            },
            conteudos: slides.map(slide => ({
                title: slide.title,
                subtitle: (slide.subtitle !== undefined && slide.subtitle !== null && slide.subtitle !== '') ? slide.subtitle : null,
                keyword: slide.keyword,
                imagem_fundo: slide.imagem_fundo || null,
                imagem_fundo2: slide.imagem_fundo2 || null,
                imagem_fundo3: slide.imagem_fundo3 || null,
                // Unsplash Compliance: atribuições e status de download
                unsplash_download_triggered: slide.unsplash_download_triggered || false,
                unsplash_attributions: slide.unsplash_attributions || null
            })),
            metadata: {
                generator_version: 'news_carousel_v1',
                content_type: input.content_type,
                template_name: `Template ${input.template}`,
                dimension: input.dimension || '1170x1560',
                screen_count: slides.length,
                blueprint, // Blueprint completo para referência
                generated_at: new Date().toISOString(),
                user_id: userId,
                business_id: businessId,
                // NOVO: Informação detalhada sobre múltiplas fontes
                sources: {
                    multifont,
                    primary_url: input.url,
                    additional_urls: input.multiple_links || [],
                    all_urls: allUrls,
                    news_data: allNewsData.map(item => ({
                        url: item.url,
                        content_length: item.htmlText?.length || 0
                    }))
                }
            }
        };
    }
}
