/**
 * Exemplo de uso do Carousel Worker SDK
 */

import { CarouselWorkerClient } from './carousel-worker-sdk.js';

// Configuração do cliente
const client = new CarouselWorkerClient({
    workerUrl: process.env.CAROUSEL_WORKER_URL || 'http://localhost:3001',
    apiSecret: process.env.CAROUSEL_WORKER_SECRET,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY
});

// ============================================
// EXEMPLO 1: Gerar carrossel completo (modo simples)
// ============================================
async function example1_simple() {
    console.log('=== EXEMPLO 1: Modo Simples ===\n');

    try {
        const result = await client.generateCarousel({
            userId: '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
            businessId: 'business-uuid-here',
            code: 'DSHyK_IjvmS',            // Shortcode do Instagram
            template: '8',                  // Template 8
            contentType: 'cases',           // Tipo: case study
            screenCount: 10                 // 10 slides
        });

        if (result.success) {
            console.log('✅ Carrossel gerado com sucesso!');
            console.log(`Job ID: ${result.jobId}`);
            console.log(`Slides: ${result.result.conteudos.length}`);
            console.log(`Descrição: ${result.result.dados_gerais.description.substring(0, 100)}...`);
        } else {
            console.error('❌ Falha na geração:', result.error);
        }
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 2: Gerar carrossel com contexto e CTA
// ============================================
async function example2_withContext() {
    console.log('\n=== EXEMPLO 2: Com Contexto e CTA ===\n');

    try {
        const result = await client.generateCarousel({
            userId: '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
            businessId: 'business-uuid-here',
            code: 'DSHyK_IjvmS',
            template: '8',
            contentType: 'cases',
            screenCount: 10,

            // Contexto adicional (ativa brand adapter)
            context: 'Análise estratégica de como a Netflix revolucionou o streaming, ' +
                'focando em decisões estruturais que mudaram o mercado.',

            // CTA configurado
            hasCta: true,
            ctaType: 'comentar',
            ctaIntention: 'produto'
        });

        if (result.success) {
            console.log('✅ Carrossel gerado com sucesso!');
            console.log(`Job ID: ${result.jobId}`);

            // Mostrar último slide (deve ter CTA)
            const lastSlide = result.result.conteudos[result.result.conteudos.length - 1];
            console.log('\nÚltimo slide (CTA):');
            console.log(`Title: ${lastSlide.title}`);
            console.log(`Subtitle: ${lastSlide.subtitle}`);
        }
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 3: Gerar diferentes tipos de conteúdo
// ============================================
async function example3_contentTypes() {
    console.log('\n=== EXEMPLO 3: Diferentes Tipos de Conteúdo ===\n');

    const types = [
        { type: 'produto', desc: 'Produto como protagonista' },
        { type: 'historias', desc: 'História como recurso narrativo' },
        { type: 'cases', desc: 'Decisão estrutural' },
        { type: 'educacional', desc: 'Clareza operacional' },
        { type: 'sistema', desc: 'Baseado em template' }
    ];

    for (const { type, desc } of types) {
        console.log(`\n📝 Gerando ${type} (${desc})...`);

        try {
            const result = await client.generateCarousel({
                userId: '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
                businessId: 'business-uuid-here',
                code: 'DSHyK_IjvmS',
                template: '8',
                contentType: type,
                screenCount: 10
            });

            if (result.success) {
                console.log(`✅ ${type}: ${result.result.conteudos.length} slides`);
            }
        } catch (error) {
            console.error(`❌ ${type}: ${error.message}`);
        }
    }
}

// ============================================
// EXEMPLO 4: Enfileirar job já existente
// ============================================
async function example4_enqueueExisting() {
    console.log('\n=== EXEMPLO 4: Enfileirar Job Existente ===\n');

    const existingJobId = 'uuid-de-job-ja-criado';

    try {
        await client.enqueueExistingJob(existingJobId);
        console.log(`✅ Job ${existingJobId} enfileirado`);

        // Aguardar conclusão
        const result = await client._waitForCompletion(existingJobId, 120);
        console.log(result.success ? '✅ Completado' : '❌ Falhou');
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 5: Verificar status de job
// ============================================
async function example5_checkStatus() {
    console.log('\n=== EXEMPLO 5: Verificar Status ===\n');

    const jobId = 'uuid-do-job';

    try {
        const status = await client.getJobStatus(jobId);

        console.log(`Job ID: ${status.jobId}`);
        console.log(`Status: ${status.status}`);
        console.log(`Criado em: ${status.createdAt}`);
        console.log(`Atualizado em: ${status.updatedAt}`);

        if (status.status === 'completed') {
            console.log(`Slides gerados: ${status.result.conteudos.length}`);
        }

        if (status.status === 'failed') {
            console.error(`Erro: ${status.error.message}`);
        }
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 6: Listar jobs de um usuário
// ============================================
async function example6_listJobs() {
    console.log('\n=== EXEMPLO 6: Listar Jobs do Usuário ===\n');

    try {
        const jobs = await client.listUserJobs('586b820b-718a-4cb5-a0b4-2a1dfd9499a6', {
            status: 'completed',
            limit: 10
        });

        console.log(`Total de jobs completados: ${jobs.length}\n`);

        jobs.forEach((job, index) => {
            console.log(`${index + 1}. ${job.id}`);
            console.log(`   Status: ${job.status}`);
            console.log(`   Criado: ${job.created_at}`);
            console.log('');
        });
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 7: Cancelar job
// ============================================
async function example7_cancelJob() {
    console.log('\n=== EXEMPLO 7: Cancelar Job ===\n');

    const jobId = 'uuid-do-job-em-fila';

    try {
        await client.cancelJob(jobId);
        console.log(`✅ Job ${jobId} cancelado`);
    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

// ============================================
// EXEMPLO 8: Workflow completo com tratamento de erro
// ============================================
async function example8_completeWorkflow() {
    console.log('\n=== EXEMPLO 8: Workflow Completo ===\n');

    try {
        console.log('1️⃣ Iniciando geração...');

        const result = await client.generateCarousel({
            userId: '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
            businessId: 'business-uuid-here',
            code: 'DSHyK_IjvmS',
            template: '8',
            contentType: 'produto',
            screenCount: 10,
            context: 'Lançamento de novo produto SaaS',
            hasCta: true,
            ctaType: 'visitar',
            ctaIntention: 'produto',
            timeoutSeconds: 180 // 3 minutos
        });

        if (!result.success) {
            throw new Error(result.error.message || 'Generation failed');
        }

        console.log('2️⃣ Carrossel gerado com sucesso!');
        console.log(`   Job ID: ${result.jobId}`);
        console.log(`   Slides: ${result.result.conteudos.length}`);

        console.log('\n3️⃣ Processando slides...');

        // Processar cada slide
        for (let i = 0; i < result.result.conteudos.length; i++) {
            const slide = result.result.conteudos[i];
            console.log(`   Slide ${i + 1}/${result.result.conteudos.length}`);
            console.log(`   - Title: ${slide.title}`);
            console.log(`   - Keyword: ${slide.keyword}`);

            // Aqui você pode:
            // - Buscar imagens no Unsplash usando slide.keyword
            // - Gerar imagem com IA
            // - Renderizar slide no frontend
        }

        console.log('\n4️⃣ Salvando metadados...');
        // Salvar metadados em outra tabela, cache, etc.

        console.log('\n✅ Workflow completo!');

        return result;
    } catch (error) {
        console.error('\n❌ Erro no workflow:', error.message);

        // Tratamento de erro específico
        if (error.message.includes('timeout')) {
            console.error('   Motivo: Timeout - o worker pode estar sobrecarregado');
        } else if (error.message.includes('Worker API error')) {
            console.error('   Motivo: Worker indisponível ou erro de autenticação');
        } else if (error.message.includes('Failed to create job')) {
            console.error('   Motivo: Erro no banco de dados');
        }

        throw error;
    }
}

// ============================================
// Executar exemplos
// ============================================
async function main() {
    console.log('🚀 Carousel Worker SDK - Exemplos de Uso\n');
    console.log('=========================================\n');

    // Escolha qual exemplo executar:

    // await example1_simple();
    // await example2_withContext();
    // await example3_contentTypes();
    // await example4_enqueueExisting();
    // await example5_checkStatus();
    // await example6_listJobs();
    // await example7_cancelJob();
    await example8_completeWorkflow();
}

// Executar
main().catch(console.error);
