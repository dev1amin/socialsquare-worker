/**
 * Pricing Tracker (worker)
 *
 * Insere registros em carousel.provider_usage para cada chamada externa
 * feita durante a geração do carrossel. Best-effort: nunca quebra a geração.
 *
 * Pricing é lido de carousel.provider_pricing (cache de 5 min).
 */

import { supabase } from '../config/supabase.js';
import { logger } from '../config/logger.js';

let pricingCache = { data: null, fetchedAt: 0 };
const PRICING_TTL_MS = 5 * 60 * 1000;

async function loadPricing() {
    const now = Date.now();
    if (pricingCache.data && now - pricingCache.fetchedAt < PRICING_TTL_MS) {
        return pricingCache.data;
    }
    try {
        const { data, error } = await supabase
            .schema('carousel')
            .from('provider_pricing')
            .select('*')
            .eq('active', true);
        if (error) throw error;
        pricingCache = { data: data || [], fetchedAt: now };
    } catch (err) {
        logger.warn(`[pricing] failed to load pricing rows: ${err.message}`);
        pricingCache = { data: [], fetchedAt: now };
    }
    return pricingCache.data;
}

function computeCostUsd(rows, { provider, model, inputTokens = 0, outputTokens = 0, units = 1 }) {
    if (provider === 'openai') {
        const inP = rows.find((p) => p.provider === 'openai' && p.kind === 'per_1m_input_tokens' && (!p.model || p.model === model));
        const outP = rows.find((p) => p.provider === 'openai' && p.kind === 'per_1m_output_tokens' && (!p.model || p.model === model));
        const inputCost = inP ? (inputTokens / 1_000_000) * Number(inP.unit_cost_usd) : 0;
        const outputCost = outP ? (outputTokens / 1_000_000) * Number(outP.unit_cost_usd) : 0;
        return inputCost + outputCost;
    }
    const sub = rows.find((p) => p.provider === provider && p.kind === 'monthly_subscription');
    if (sub && sub.monthly_quota && sub.monthly_quota > 0) {
        return (Number(sub.unit_cost_usd) / sub.monthly_quota) * units;
    }
    const perReq = rows.find((p) => p.provider === provider && p.kind === 'per_request');
    if (perReq) return Number(perReq.unit_cost_usd) * units;
    return 0;
}

/**
 * Registra um uso de provider externo. Nunca lança.
 *
 * @param {Object} u
 * @param {number|null} u.jobId
 * @param {string|null} [u.userId]
 * @param {string|null} [u.businessId]
 * @param {string} u.provider           - 'openai', 'rocketapi', 'tavily', 'google_images', 'unsplash'
 * @param {string} [u.operation]
 * @param {string} [u.model]
 * @param {number} [u.units=1]
 * @param {number} [u.inputTokens=0]
 * @param {number} [u.outputTokens=0]
 * @param {Object} [u.metadata]
 */
export async function trackUsage(u) {
    try {
        const pricing = await loadPricing();
        const cost = computeCostUsd(pricing, {
            provider: u.provider,
            model: u.model,
            inputTokens: u.inputTokens || 0,
            outputTokens: u.outputTokens || 0,
            units: u.units ?? 1,
        });
        await supabase.schema('carousel').from('provider_usage').insert({
            job_id: u.jobId ?? null,
            user_id: u.userId ?? null,
            business_id: u.businessId ?? null,
            provider: u.provider,
            operation: u.operation ?? null,
            model: u.model ?? null,
            units: u.units ?? 1,
            input_tokens: u.inputTokens || 0,
            output_tokens: u.outputTokens || 0,
            cost_usd: cost,
            metadata: u.metadata ?? null,
        });
    } catch (err) {
        logger.warn(`[pricing] trackUsage failed: ${err.message}`);
    }
}

/**
 * Flush de um TokenTracker (consolidação dos tokens OpenAI por agent)
 * para a tabela provider_usage. Best-effort.
 *
 * @param {Object} ctx
 * @param {number|null} ctx.jobId
 * @param {string|null} [ctx.userId]
 * @param {string|null} [ctx.businessId]
 * @param {string} [ctx.model='gpt-4o-mini']
 * @param {Object} ctx.tokenTracker  - instância de TokenTracker
 */
export async function flushTokenTracker({ jobId, userId, businessId, model = 'gpt-4o-mini', tokenTracker }) {
    if (!tokenTracker || !tokenTracker.agents) return;
    const entries = Object.entries(tokenTracker.agents);
    await Promise.all(entries.map(([agentName, t]) =>
        trackUsage({
            jobId,
            userId,
            businessId,
            provider: 'openai',
            operation: `chat.completion:${agentName}`,
            model,
            units: 1,
            inputTokens: t.input || 0,
            outputTokens: t.output || 0,
            metadata: { agent: agentName },
        })
    ));
}
