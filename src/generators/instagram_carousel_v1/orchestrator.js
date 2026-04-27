import { logger } from '../../config/logger.js';
import { supabase } from '../../config/supabase.js';
import * as generatedContentRepo from '../../db/generatedContent.repo.js';
import { CarouselTemplatesRepository } from '../../db/carouselTemplates.repo.js';
import { UserBusinessRepository } from '../../db/userBusiness.repo.js';
import * as influencerContentRepo from '../../db/influencerContent.repo.js';
import rocketApiClient from '../../services/rocketapi.client.js';
import { unsplashService } from '../../services/unsplash.service.js';
import { videoFrameExtractorService } from '../../services/videoFrameExtractor.service.js';
import { ImageAnalyzerAgent } from './agents/imageAnalyzer.agent.js';
import { BlueprintGeneratorAgent } from './agents/blueprintGenerator.agent.js';
import { BlueprintValidatorAgent } from './agents/blueprintValidator.agent.js';
import { ContentTypeRouter } from './routers/contentType.router.js';
import { KeywordAgent } from './agents/keyword.agent.js';
import { BrandAdapterAgent } from './agents/brandAdapter.agent.js';
import { CTAValidatorAgent } from './agents/ctaValidator.agent.js';
import { DescriptionAgent } from './agents/description.agent.js';
import { ResearchAgent } from './agents/research.agent.js';
import { trackUsage } from '../../services/pricingTracker.service.js';

/**
 * Orchestrator para geração de carrossel Instagram
 * Pipeline completo de geração de carrossel a partir de URL/Instagram:
 * 1. Busca dados do job/template/brand do banco
 * 2. RocketAPI → busca post(s) do Instagram (suporta múltiplos)
 * 3. ImageAnalyzer → OCR + descrição visual (GPT-4O Vision)
 * 4. Analyzer → blueprint 42 chaves
 * 5. BlueprintValidator → valida/corrige blueprint
 * 6. ContentTypeRouter → roteia para gerador específico
 * 7. KeywordAgent → adiciona keywords para imagens
 * 8. BrandAdapter → adapta ao tom de voz (OPCIONAL)
 * 9. CTAValidator → valida CTA se necessário (OPCIONAL)
 * 10. DescriptionAgent → gera descrição final
 * 
 * NOVO: Suporta geração a partir de múltiplos posts/notícias via:
 * - input.multiple_links: array de códigos adicionais
 * - input.multifont: boolean flag indicando múltiplas fontes
 */
export class InstagramCarouselOrchestrator {
    constructor(jobId, traceId, tokenTracker) {
        this.jobId = jobId;
        this.traceId = traceId || `job-${jobId}`;
        this.tokenTracker = tokenTracker;

        // Instanciar repositories
        this.carouselTemplatesRepo = new CarouselTemplatesRepository();
        this.userBusinessRepo = new UserBusinessRepository();

        // Agentes do pipeline
        this.imageAnalyzer = new ImageAnalyzerAgent(tokenTracker);
        this.blueprintGenerator = new BlueprintGeneratorAgent(tokenTracker);
        this.blueprintValidator = new BlueprintValidatorAgent(tokenTracker);
        this.router = new ContentTypeRouter(tokenTracker);
        this.keywordAgent = new KeywordAgent(tokenTracker);
        this.brandAdapter = new BrandAdapterAgent(tokenTracker);
        this.ctaValidator = new CTAValidatorAgent(tokenTracker);
        this.descriptionAgent = new DescriptionAgent(tokenTracker);
        this.researchAgent = new ResearchAgent(this.traceId);
    }

    /**
     * Busca dados de múltiplos posts do Instagram
     * Continua processando mesmo se algum falhar
     */
    async fetchMultipleInstagramData(codes) {
        const allData = [];

        for (const code of codes) {
            try {
                logger.info(`[${this.traceId}] Fetching Instagram data for code: ${code}`);
                const rocketData = await rocketApiClient.getCarouselByCode(code);
                allData.push({
                    code,
                    data: rocketData
                });
                trackUsage({
                    jobId: this.jobId,
                    userId: this.userId,
                    businessId: this.businessId,
                    provider: 'rocketapi',
                    operation: 'instagram.get_carousel_by_code',
                    units: 1,
                    metadata: { code },
                });
                logger.info(`[${this.traceId}] Successfully fetched data for code: ${code}`);
            } catch (error) {
                logger.warn(`[${this.traceId}] Failed to fetch Instagram data for code ${code}: ${error.message}`);
                // Continua com outros códigos, não falha completamente
            }
        }

        if (allData.length === 0) {
            logger.warn(`[${this.traceId}] Failed to fetch any Instagram data from ${codes.length} codes`);
        }

        return allData;
    }

    /**
     * Constrói texto combinado de todas as fontes para geração
     * Concatena: captions do Instagram + textos adicionais da API
     */
    buildCombinedText(allRocketData, combinedSources, additionalTexts) {
        const parts = [];
        
        // Parte 1: Captions do Instagram
        // Nota: RocketAPI retorna { imageUrls, metadata: { caption: '...' } }
        if (allRocketData && allRocketData.length > 0) {
            allRocketData.forEach((item, idx) => {
                // Caption está em metadata.caption, não diretamente em data.caption
                const caption = item.data?.metadata?.caption || item.data?.caption || '';
                if (caption) {
                    if (allRocketData.length > 1) {
                        parts.push(`[FONTE INSTAGRAM ${idx + 1} - @${item.data?.metadata?.username || item.code}]\n${caption}`);
                    } else {
                        parts.push(`[CONTEÚDO PRINCIPAL INSTAGRAM]\n${caption}`);
                    }
                }
            });
        }
        
        // Parte 2: Textos adicionais (de URLs - já extraídos pela API)
        if (additionalTexts && additionalTexts.length > 0) {
            additionalTexts.forEach((text, idx) => {
                if (text && text.trim()) {
                    parts.push(`[FONTE ADICIONAL ${idx + 1} - NOTÍCIA/ARTIGO]\n${text}`);
                }
            });
        }
        
        // Se não tiver nada, retorna string vazia
        if (parts.length === 0) {
            return '';
        }
        
        return parts.join('\n\n---\n\n');
    }

    /**
     * Executa pipeline completo de geração
     * Busca todos os dados necessários do banco e executa o pipeline
     */
    async generate() {
        try {
            logger.info(`[${this.traceId}] Starting generation for job ${this.jobId}`);

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
            
            // NOVO: Extrair textos adicionais da API (additional_texts, post_text, context)
            const additionalTexts = input.additional_texts || [];
            const postText = input.post_text || input.caption || null;
            const articleText = input.article_text || input.content || null;
            const userContext = input.context || '';
            
            logger.info(`[${this.traceId}] Job loaded: content_type=${input.content_type}, has_context=${!!userContext}, has_cta=${!!input.has_cta}, multifont=${multifont}`);
            logger.info(`[${this.traceId}] Additional content: post_text=${!!postText}, article_text=${!!articleText}, additional_texts=${additionalTexts.length}`);
            
            // DEBUG: Log dos textos adicionais
            if (additionalTexts.length > 0) {
                logger.info(`[${this.traceId}] Additional texts preview: ${additionalTexts.map((t, i) => `[${i}]: ${t?.substring(0, 100)}...`).join(' | ')}`);
            }

            // ETAPA 2: Buscar codes do conteúdo (Instagram posts)
            // Prioridade: input.code > contentId do banco
            let instagramCodes = [];
            let instagramCode = input.code; // Primeiro tenta o que foi enviado pelo frontend
            if (!instagramCode && contentId) {
                logger.info(`[${this.traceId}] No code in input, fetching from content_id ${contentId}...`);
                const contentData = await influencerContentRepo.getContentById(contentId);
                instagramCode = contentData.code;
            }

            if (instagramCode) {
                instagramCodes.push(instagramCode);
                logger.info(`[${this.traceId}] Primary Instagram code: ${instagramCode}`);
            } else {
                logger.info(`[${this.traceId}] No primary Instagram code provided, carousel will be generated without specific reference content`);
            }

            // Se houver múltiplas fontes, adiciona as outras
            // Aceita: multiple_links, additional_codes, ou additional_urls (para códigos de Instagram)
            // NOTA: additional_urls pode conter códigos do Instagram OU URLs de notícias
            // Se parecem códigos do Instagram (alfanuméricos curtos), usa como códigos
            let additionalCodes = input.multiple_links || input.additional_codes || [];
            
            // Se additional_urls existe e não temos additional_codes, verifica se são códigos de Instagram
            if (additionalCodes.length === 0 && input.additional_urls && Array.isArray(input.additional_urls)) {
                // Verifica se os valores parecem códigos de Instagram (não são URLs completas)
                const possibleCodes = input.additional_urls.filter(url => {
                    // Se não começa com http e é relativamente curto, provavelmente é um código
                    return url && !url.startsWith('http') && url.length < 50;
                });
                
                if (possibleCodes.length > 0) {
                    additionalCodes = possibleCodes;
                    logger.info(`[${this.traceId}] Detected Instagram codes in additional_urls: ${possibleCodes.join(', ')}`);
                }
            }
            
            if (multifont && Array.isArray(additionalCodes) && additionalCodes.length > 0) {
                instagramCodes.push(...additionalCodes);
                logger.info(`[${this.traceId}] Multiple posts detected. Total codes: ${instagramCodes.length} (primary: ${instagramCode}, additional: ${additionalCodes.join(', ')})`);
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

            // ETAPA 5: Buscar dados do Instagram via RocketAPI (suporta múltiplos)
            let allRocketData = [];
            if (instagramCodes.length > 0) {
                if (multifont && instagramCodes.length > 1) {
                    // NOVO: Buscar múltiplos posts
                    logger.info(`[${this.traceId}] Fetching data from ${instagramCodes.length} Instagram posts...`);
                    allRocketData = await this.fetchMultipleInstagramData(instagramCodes);
                } else {
                    // Fluxo existente: 1 post
                    logger.info(`[${this.traceId}] Fetching Instagram data via RocketAPI (code: ${instagramCodes[0]})...`);
                    const rocketData = await rocketApiClient.getCarouselByCode(instagramCodes[0]);
                    allRocketData = [{ code: instagramCodes[0], data: rocketData }];
                    trackUsage({
                        jobId: this.jobId,
                        userId: this.userId,
                        businessId: this.businessId,
                        provider: 'rocketapi',
                        operation: 'instagram.get_carousel_by_code',
                        units: 1,
                        metadata: { code: instagramCodes[0] },
                    });
                }
            } else {
                logger.info(`[${this.traceId}] No Instagram codes available, skipping RocketAPI fetch`);
            }

            // ETAPA 5.1: Auto-fetch foto de perfil do próprio usuário se negócio não tem logo
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
                        } else {
                            logger.warn(`[${this.traceId}] Failed to save profile picture: ${error.message}`);
                        }
                    }
                } catch (err) {
                    logger.warn(`[${this.traceId}] Error fetching user profile pic: ${err.message}`);
                }
            }

            // ETAPA 6: Extrair frames de vídeos (se houver) - suporta múltiplas fontes
            let extractedFrames = [];
            if (allRocketData.length > 0) {
                for (const rocketItem of allRocketData) {
                    const rocketData = rocketItem.data;
                    if (rocketData?.metadata?.video_count > 0) {
                        logger.info(`[${this.traceId}] Extracting frames from ${rocketData.metadata.video_count} video(s) in ${rocketItem.code}...`);
                        const videoSlides = rocketData.metadata.slides.filter(s => s.type === 'video');
                        logger.debug(`[${this.traceId}] Video slides to extract: ${JSON.stringify(videoSlides, null, 2)}`);
                        const frames = await videoFrameExtractorService.extractFrames(videoSlides);
                        extractedFrames.push(...frames);
                        logger.info(`[${this.traceId}] Extracted ${frames.length} video frames from ${rocketItem.code}`);
                    }
                }
            }

            // ETAPA 7: Image Analyzer - OCR + descrição visual (GPT-4O Vision)
            // Nota: Para múltiplas fontes, concatena todas as imagens
            logger.info(`[${this.traceId}] Analyzing images (OCR + visual description)...`);
            const allImageUrls = allRocketData.flatMap(item => item.data?.imageUrls || []);
            const imageAnalysis = await this.imageAnalyzer.analyze({
                imageUrls: allImageUrls,
                metadata: {
                    // Para múltiplas fontes, passa contexto de cada fonte
                    sources: multifont ? allRocketData.map(item => ({
                        code: item.code,
                        metadata: item.data?.metadata
                    })) : allRocketData[0]?.data?.metadata || {},
                    extractedFrames,
                    multifont
                }
            });

            // ETAPA 8: Blueprint Generator - gera blueprint narrativo (42 chaves)
            // NOVO: Combina textos do Instagram + textos adicionais da API
            logger.info(`[${this.traceId}] Running blueprint generator to generate blueprint...`);
            
            // Monta conteúdo combinado de todas as fontes
            const combinedSources = [];
            
            // Fonte 1: Captions do Instagram (RocketAPI)
            // Nota: RocketAPI retorna { imageUrls, metadata: { caption: '...' } }
            if (allRocketData.length > 0) {
                allRocketData.forEach((item, idx) => {
                    // Caption está em metadata.caption, não diretamente em data.caption
                    const caption = item.data?.metadata?.caption || item.data?.caption || '';
                    if (caption) {
                        combinedSources.push({
                            type: 'instagram',
                            code: item.code,
                            content: caption
                        });
                    }
                });
            }
            
            // Fonte 2: post_text ou article_text fornecido diretamente
            if (postText) {
                combinedSources.push({
                    type: 'post_text',
                    content: postText
                });
            }
            if (articleText) {
                combinedSources.push({
                    type: 'article',
                    content: articleText
                });
            }
            
            // Fonte 3: additional_texts (textos extraídos de URLs adicionais)
            if (additionalTexts.length > 0) {
                additionalTexts.forEach((text, idx) => {
                    combinedSources.push({
                        type: 'additional_url',
                        index: idx + 1,
                        content: text
                    });
                });
            }

            // Fonte 4: Pesquisa prévia com fontes confiáveis (Tavily — best-effort)
            let researchResult = null;
            try {
                // Tópico da pesquisa: usa userContext; se vazio, usa primeira caption ou nome do negócio
                const firstCaption = allRocketData[0]?.data?.metadata?.caption || allRocketData[0]?.data?.caption || '';
                const researchTopic = (userContext && userContext.trim())
                    || (firstCaption ? firstCaption.substring(0, 200) : '')
                    || (brandData?.objective || brandData?.name || '');

                if (researchTopic) {
                    const shortCtx = [brandData?.name, brandData?.objective, brandData?.target_audience]
                        .filter(Boolean)
                        .join(' | ');
                    researchResult = await this.researchAgent.run({
                        topic: researchTopic,
                        businessContext: shortCtx,
                        maxResults: 5,
                    });
                    if (researchResult?.provider === 'tavily') {
                        trackUsage({
                            jobId: this.jobId,
                            userId: this.userId,
                            businessId: this.businessId,
                            provider: 'tavily',
                            operation: 'search',
                            units: 1,
                            metadata: { sources: researchResult.sources?.length || 0 },
                        });
                    }
                    if (researchResult?.summary) {
                        combinedSources.push({
                            type: 'research',
                            provider: researchResult.provider,
                            content: researchResult.summary,
                        });
                        logger.info(`[${this.traceId}] ResearchAgent: ${researchResult.sources.length} fontes adicionadas ao combinedSources`);
                    }
                } else {
                    logger.info(`[${this.traceId}] ResearchAgent: sem tópico para pesquisar, pulando`);
                }
            } catch (err) {
                logger.warn(`[${this.traceId}] ResearchAgent falhou (ignorando): ${err.message}`);
            }

            logger.info(`[${this.traceId}] Combined ${combinedSources.length} content sources for generation`);
            if (combinedSources.length > 0) {
                logger.debug(`[${this.traceId}] Sources: ${combinedSources.map(s => `${s.type}${s.code ? ':' + s.code : ''}(${s.content?.length || 0} chars)`).join(', ')}`);
            }
            
            const blueprint = await this.blueprintGenerator.analyze({
                imageAnalysis,
                context: userContext,
                // NOVO: Passa todos os textos combinados
                additionalTexts,
                combinedSources,
                // Contexto de múltiplas fontes
                // Nota: Caption está em metadata.caption
                sources: multifont ? allRocketData.map(item => ({
                    code: item.code,
                    shortcode: item.data?.metadata?.shortcode || item.data?.shortcode,
                    caption: item.data?.metadata?.caption || item.data?.caption || ''
                })) : (allRocketData[0]?.data ? [{
                    code: allRocketData[0].code,
                    shortcode: allRocketData[0].data?.metadata?.shortcode || allRocketData[0].data.shortcode,
                    caption: allRocketData[0].data?.metadata?.caption || allRocketData[0].data.caption || ''
                }] : []),
                multifont
            });

            // ETAPA 9: Blueprint Validator - valida e corrige blueprint
            logger.info(`[${this.traceId}] Validating blueprint...`);
            const validatedBlueprint = await this.blueprintValidator.validate(blueprint);

            // ETAPA 10: Content Type Router - seleciona e executa gerador apropriado
            logger.info(`[${this.traceId}] Generating slides (content_type: ${input.content_type})...`);
            
            // NOVO: Prepara conteúdo combinado para o gerador
            // Inclui caption do Instagram + textos adicionais da API
            
            // Monta todas as captions de todos os posts do Instagram
            // Nota: Caption está em metadata.caption
            const allCaptions = allRocketData
                .map(item => item.data?.metadata?.caption || item.data?.caption || '')
                .filter(c => c && c.trim());
            
            const contentForGenerator = {
                // Conteúdo principal (Instagram) - inclui dados do primeiro post para compatibilidade
                ...(allRocketData.length > 0 ? allRocketData[0].data : {}),
                // Todas as fontes combinadas
                combinedSources,
                // Textos adicionais
                additionalTexts,
                // Caption principal (para compatibilidade com código legado)
                caption: allCaptions[0] || postText || '',
                // NOVO: Todas as captions de todos os posts
                allCaptions,
                // Texto formatado para o gerador (concatena tudo)
                text: this.buildCombinedText(allRocketData, combinedSources, additionalTexts),
                // Array com dados de múltiplas fontes (se multifont)
                allSources: allRocketData
            };
            
            // Log para debug
            logger.info(`[${this.traceId}] Content for generator: ${allCaptions.length} Instagram captions, ${additionalTexts.length} additional texts, text length: ${contentForGenerator.text?.length || 0}`);
            
            const slides = await this.router.generate(
                input.content_type,
                validatedBlueprint,
                contentForGenerator,
                templateData,
                { 
                    ...input, 
                    multifont, 
                    context: userContext, 
                    additionalTexts,  // camelCase
                    additional_texts: additionalTexts,  // snake_case (para compatibilidade)
                    combinedSources,
                    allCaptions  // NOVO: passar todas as captions
                }
            );

            // ETAPA 11: Keyword Agent - adiciona keywords para busca de imagens
            logger.info(`[${this.traceId}] Adding keywords for image search...`);
            const slidesWithKeywords = await this.keywordAgent.addKeywords(slides, input);

            // ETAPA 11.5: Google Images - busca imagens para entidades famosas (se configurado)
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

            // ETAPA 11.7: Tavily Images - busca imagens para slides com entity_name ou google_keyword
            // Regra: apenas slides com nome próprio identificado vão para o Tavily.
            // Slides sem entidade vão direto para o Unsplash (ETAPA 12), evitando 100% Tavily.
            try {
                const { searchPersonImages } = await import('../../services/tavily-images.service.js');
                const entitySlides = slidesForUnsplash
                    .map((s, idx) => ({ s, idx }))
                    .filter(({ s }) => {
                        if (s._googleImageUsed) return false;
                        // Usa entity_name (nome próprio extraído pelo keyword agent) ou google_keyword
                        return (s.entity_name && s.entity_name.trim()) ||
                               (s.google_keyword && s.google_keyword.trim());
                    });

                if (entitySlides.length > 0) {
                    logger.info(`[${this.traceId}] Fetching Tavily images for ${entitySlides.length} named-entity slides...`);
                    const results = await Promise.all(
                        entitySlides.map(({ s }) => {
                            // entity_name tem prioridade (nome literal); google_keyword como fallback
                            const query = (s.entity_name && s.entity_name.trim())
                                ? s.entity_name.trim()
                                : s.google_keyword.trim();
                            return searchPersonImages(query, { appendPhoto: false });
                        })
                    );
                    let tavilyUsed = 0;
                    entitySlides.forEach(({ idx }, i) => {
                        const r = results[i];
                        if (r?.imagem_fundo) {
                            slidesForUnsplash[idx] = {
                                ...slidesForUnsplash[idx],
                                imagem_fundo: r.imagem_fundo,
                                imagem_fundo2: r.imagem_fundo2,
                                imagem_fundo3: r.imagem_fundo3,
                                tavily_attributions: r.tavily_attributions,
                                image_source: 'tavily',
                                _tavilyImageUsed: true,
                            };
                            tavilyUsed++;
                        }
                        // Se Tavily não retornou nada, o slide fica sem _tavilyImageUsed
                        // e cai normalmente no Unsplash (ETAPA 12)
                    });
                    logger.info(`[${this.traceId}] Tavily images used for ${tavilyUsed}/${entitySlides.length} slides`);
                }
            } catch (err) {
                logger.warn(`[${this.traceId}] Tavily images step failed, falling back to Unsplash: ${err.message}`);
            }

            // ETAPA 11.8: Aplica imagens REAIS do(s) post(s) do Instagram (allImageUrls)
            // Capa sempre recebe a primeira; demais imagens vão para slides com
            // google_keyword ainda sem imagem.
            try {
                const pool = Array.isArray(allImageUrls)
                    ? allImageUrls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0)
                    : [];
                if (pool.length > 0) {
                    const isFilled = (s) => Boolean(s && (s._tavilyImageUsed || s._googleImageUsed || s._articleImageUsed));

                    if (slidesForUnsplash[0] && !isFilled(slidesForUnsplash[0])) {
                        const url = pool.shift();
                        slidesForUnsplash[0] = {
                            ...slidesForUnsplash[0],
                            imagem_fundo: url,
                            imagem_fundo2: pool[0] || null,
                            imagem_fundo3: pool[1] || null,
                            image_source: 'instagram',
                            _articleImageUsed: true,
                        };
                        logger.info(`[${this.traceId}] Instagram image applied to cover slide`);
                    }

                    let used = 1;
                    for (let i = 1; i < slidesForUnsplash.length && pool.length > 0; i++) {
                        const s = slidesForUnsplash[i];
                        if (isFilled(s)) continue;
                        if (!s.google_keyword) continue;
                        const url = pool.shift();
                        slidesForUnsplash[i] = {
                            ...s,
                            imagem_fundo: url,
                            imagem_fundo2: pool[0] || null,
                            imagem_fundo3: pool[1] || null,
                            image_source: 'instagram',
                            _articleImageUsed: true,
                        };
                        used++;
                    }
                    logger.info(`[${this.traceId}] Instagram images applied to ${used} slide(s)`);
                }
            } catch (err) {
                logger.warn(`[${this.traceId}] Instagram images apply step failed: ${err.message}`);
            }

            // ETAPA 12: Unsplash - busca imagens de fundo (usa frames extraídos para slides de vídeo)
            logger.info(`[${this.traceId}] Fetching background images from Unsplash...`);
            const slidesWithImages = await unsplashService.addBackgroundImages(slidesForUnsplash, extractedFrames);

            // ETAPA 12.5: Unsplash Compliance - trigger downloads para imagens usadas
            logger.info(`[${this.traceId}] Triggering Unsplash downloads for compliance...`);
            const slidesWithDownloads = await unsplashService.triggerDownloadsForSlides(slidesWithImages);

            // ETAPA 13: Brand Adapter - adapta ao tom de voz (OPCIONAL - só se tiver context ou múltiplas fontes)
            let adaptedSlides = slidesWithDownloads;
            if ((userContext || additionalTexts.length > 0) && brandData) {
                logger.info(`[${this.traceId}] Adapting to brand voice...`);
                // IMPORTANTE: brandAdapter.adapt espera (slides, brandData, context) como parâmetros separados
                adaptedSlides = await this.brandAdapter.adapt(
                    slidesWithDownloads,
                    brandData,
                    userContext
                );
                
                // Validar que retornou a mesma quantidade de slides
                if (adaptedSlides.length !== slidesWithDownloads.length) {
                    logger.warn(`[${this.traceId}] Brand adapter changed slide count: ${slidesWithDownloads.length} -> ${adaptedSlides.length}. Using original slides.`);
                    adaptedSlides = slidesWithDownloads;
                }
            } else {
                logger.info(`[${this.traceId}] Skipping brand adaptation (no context or brand data)`);
            }

            // ETAPA 14: CTA Validator - valida/adiciona CTA (OPCIONAL - só se has_cta=true)
            if (input.has_cta) {
                logger.info(`[${this.traceId}] Validating CTA...`);
                adaptedSlides = await this.ctaValidator.ensureCTA(adaptedSlides, input, validatedBlueprint);
            } else {
                logger.info(`[${this.traceId}] Skipping CTA validation (has_cta=false)`);
            }

            // ETAPA 15: Description Agent - gera descrição final do carrossel
            logger.info(`[${this.traceId}] Generating carousel description...`);
            const description = await this.descriptionAgent.generate({
                slides: adaptedSlides,
                brandData,
                context: userContext,
                descriptionLength: input.description_length,
                multifont,
                additionalTexts,
                // NOVO: Passa lista de códigos para descrição
                sourcesCodes: instagramCodes
            });

            // ETAPA 16: Monta resultado final
            const result = this.buildFinalResult(
                adaptedSlides,
                description,
                validatedBlueprint,
                allRocketData,
                brandData,
                input,
                userId,
                businessId,
                instagramCodes,
                researchResult
            );

            logger.info(`[${this.traceId}] Generation completed successfully (${adaptedSlides.length} slides, ${instagramCodes.length} source(s))`);
            return result;
        } catch (error) {
            logger.error(`[${this.traceId}] Generation failed: ${error.message}`, {
                stack: error.stack,
                stage: error.stage || 'orchestrator'
            });
            throw error;
        }
    }

    /**
     * Monta resultado final no schema padronizado
     * Formato padronizado do resultado
     * 
     * ⚠️ UNSPLASH COMPLIANCE: Inclui atribuições completas para cada imagem
     * ⚠️ MÚLTIPLAS FONTES: Inclui informação de todas as fontes no metadata
     */
    buildFinalResult(slides, description, blueprint, allRocketData, brandData, input, userId, businessId, allCodes, researchResult) {
        // Normalizar allRocketData para trabalhar tanto com array quanto com objeto único
        const rocketDataArray = Array.isArray(allRocketData) ? 
            allRocketData.map(item => item?.data || item) : 
            [allRocketData];

        const primaryRocketData = rocketDataArray[0];
        const multifont = input.multifont === true;

        return {
            // CAMPO RAIZ: description para acesso direto pela API
            description,
            dados_gerais: {
                nome: brandData?.name || 'Unknown',
                arroba: brandData?.instagram || '',
                foto_perfil: brandData?.logo_url || '',
                template: input.template,
                description,
                // NOVO: Indicar se foi gerado a partir de múltiplas fontes
                multifont,
                sources: multifont ? allCodes : [input.code]
            },
            // Fontes externas (Tavily) usadas como research — separadas das fontes Instagram
            sources: (researchResult?.sources || []).slice(0, 8).map((s) => ({
                title: s.title,
                url: s.url,
                snippet: (s.content || '').substring(0, 240),
                publishedDate: s.publishedDate,
            })),
            conteudos: slides.map(slide => ({
                title: slide.title,
                subtitle: (slide.subtitle !== undefined && slide.subtitle !== null && slide.subtitle !== '') ? slide.subtitle : null,
                keyword: slide.keyword,
                video_url: slide.video_url || null,
                imagem_fundo: slide.imagem_fundo || null,
                imagem_fundo2: slide.imagem_fundo2 || null,
                imagem_fundo3: slide.imagem_fundo3 || null,
                // Unsplash Compliance: atribuições e status de download
                unsplash_download_triggered: slide.unsplash_download_triggered || false,
                unsplash_attributions: slide.unsplash_attributions || null
            })),
            metadata: {
                generator_version: 'instagram_carousel_v1',
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
                    primary_code: input.code,
                    additional_codes: input.multiple_links || [],
                    all_codes: allCodes,
                    research_provider: researchResult?.provider || 'none',
                    research_sources_count: researchResult?.sources?.length || 0,
                    instagram_data: allRocketData.map((item, idx) => {
                        const data = Array.isArray(allRocketData) ? item.data : item;
                        const code = Array.isArray(allRocketData) ? item.code : (allCodes?.[idx] || 'unknown');
                        // Caption está em metadata.caption
                        const caption = data?.metadata?.caption || data?.caption || '';
                        return {
                            code,
                            shortcode: data?.metadata?.shortcode || data?.shortcode || code,
                            caption: caption.substring(0, 100) + (caption.length > 100 ? '...' : ''),
                            slide_count: data?.metadata?.slides?.length || 0,
                            video_count: data?.metadata?.video_count || 0
                        };
                    })
                }
            }
        };
    }
}
