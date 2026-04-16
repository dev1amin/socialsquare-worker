# Arquitetura do Carousel Worker - Integração com n8n

## Visão Geral

O worker foi redesenhado para replicar fielmente o fluxo do n8n, onde:

1. **Worker recebe apenas `job_id`** (minimal payload pattern)
2. **Busca todos os dados do banco** (job, template, brand, instagram data)
3. **Pipeline condicional** (brand adapter e CTA validator são opcionais)
4. **Resultado padronizado** no formato do n8n

---

## Fluxo Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. HTTP Request ou Queue recebe job_id                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Worker busca job do banco (generated_content)                    │
│    - input_data: { code, template, content_type, context, has_cta }│
│    - user_id, business_id                                           │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. Orchestrator busca dados complementares:                         │
│    - Template do Supabase (carousel.templates)                      │
│    - Brand Data do Supabase (carousel.user_business)                │
│    - Instagram Data via RocketAPI                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. PIPELINE DE AGENTES (seguindo ordem do n8n):                     │
│                                                                      │
│    4.1. ImageAnalyzerAgent (GPT-4O Vision) ★ NOVO                   │
│         → OCR + descrição visual das imagens                        │
│                                                                      │
│    4.2. AnalyzerAgent                                               │
│         → Usa imageAnalysis → blueprint 42 chaves                   │
│                                                                      │
│    4.3. BlueprintValidatorAgent                                     │
│         → Valida/corrige blueprint                                  │
│                                                                      │
│    4.4. ContentTypeRouter (SWITCH)                                  │
│         → Roteia para gerador específico:                           │
│            • produto   → ProductGenerator                           │
│            • historias → StoryGenerator                             │
│            • cases     → CaseGenerator                              │
│            • educacional → EducationalGenerator                     │
│            • sistema   → SystemGenerator                            │
│                                                                      │
│    4.5. KeywordAgent                                                │
│         → Adiciona keywords em inglês (Unsplash)                    │
│                                                                      │
│    4.6. BrandAdapterAgent (OPCIONAL - só se context existir)       │
│         → Adapta slides ao tom de voz da marca                      │
│                                                                      │
│    4.7. CTAValidatorAgent (OPCIONAL - só se has_cta=true)          │
│         → Garante presença de CTA no último slide                   │
│                                                                      │
│    4.8. DescriptionAgent                                            │
│         → Gera descrição final do carrossel                         │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. Monta resultado final no formato do n8n:                         │
│    {                                                                 │
│      dados_gerais: { nome, arroba, foto_perfil, template, description }│
│      conteudos: [{ title, subtitle, keyword, imagem_fundo* }]      │
│      metadata: { blueprint, content_type, generated_at... }         │
│    }                                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 6. Worker salva resultado e invalida cache                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Estrutura de Dados

### Input (job.input_data)

```json
{
  "code": "DSHyK_IjvmS",
  "template": "8",
  "content_type": "cases",
  "screen_count": 10,
  "context": "Comparar estratégias de crescimento...",
  "has_cta": true,
  "cta_type": "comentar",
  "cta_intention": "produto",
  "dimension": "1170x1560",
  "description_length": "curta"
}
```

### Template (carousel.templates)

```json
{
  "id": "uuid",
  "name": "Template 8",
  "slides": [
    { "title": "placeholder", "subtitle": "placeholder" },
    { "title": "placeholder", "subtitle": null },
    ...
  ]
}
```

### Brand Data (carousel.user_business)

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "Workez AI",
  "instagram": "workez.ai",
  "logo_url": "https://...",
  "brand_positioning": "Solução de IA para criadores...",
  "voice_tone": "profissional e inspirador",
  "target_audience": "criadores de conteúdo e agências",
  "forbidden_words": "barato, grátis",
  "preferred_words": "estratégico, inteligente",
  "forbidden_topics": "política, religião",
  "objective": "aumentar audiência qualificada"
}
```

### Output

```json
{
  "dados_gerais": {
    "nome": "Workez AI",
    "arroba": "workez.ai",
    "foto_perfil": "https://...",
    "template": "8",
    "description": "Descrição gerada pelo DescriptionAgent..."
  },
  "conteudos": [
    {
      "title": "Como a Netflix dominou o streaming",
      "subtitle": "Decisão que mudou tudo em 2007",
      "keyword": "netflix office",
      "imagem_fundo": null,
      "imagem_fundo2": null,
      "imagem_fundo3": null
    }
  ],
  "metadata": {
    "generator_version": "instagram_carousel_v1",
    "content_type": "cases",
    "blueprint": { /* 42 chaves */ },
    "generated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

## Agentes e Responsabilidades

### 0. ImageAnalyzerAgent (★ NOVO)
- **Modelo**: gpt-4o (com vision)
- **Função**: OCR + descrição visual das imagens do carrossel
- **Input**: Array de URLs de imagens
- **Output**: Array de { slide, texto, descrição }
- **Características**: 
  - Usa GPT-4O Vision API
  - Extrai texto visível + descreve conteúdo visual
  - Não inventa nada que não está na imagem
  - Preserva formatação (quebras de linha, maiúsculas, emojis)

### 1. AnalyzerAgent
- **Modelo**: gpt-4o
- **Função**: Recebe imageAnalysis → gera blueprint 42 chaves
- **Prompt**: [analyzer.system.txt](prompts/analyzer.system.txt)

### 2. BlueprintValidatorAgent
- **Modelo**: gpt-4o
- **Função**: Valida/corrige blueprint seguindo microgramáticas
- **Prompt**: [blueprintValidator.system.txt](prompts/blueprintValidator.system.txt)

### 3. ContentTypeRouter
Roteia para geradores específicos:

#### 3.1. ProductGenerator
- **Modelo**: chatgpt-4o-latest
- **Foco**: Produto como protagonista, argumentação estratégica
- **Prompt**: [product.system.txt](prompts/product.system.txt)

#### 3.2. StoryGenerator
- **Modelo**: chatgpt-4o-latest
- **Foco**: História como recurso narrativo
- **Prompt**: [story.system.txt](prompts/story.system.txt)

#### 3.3. CaseGenerator
- **Modelo**: chatgpt-4o-latest
- **Foco**: Decisão estrutural como protagonista
- **Prompt**: [case.system.txt](prompts/case.system.txt)

#### 3.4. EducationalGenerator
- **Modelo**: chatgpt-4o-latest
- **Foco**: Clareza operacional, sem histórias
- **Prompt**: [educational.system.txt](prompts/educational.system.txt)

#### 3.5. SystemGenerator
- **Modelo**: chatgpt-4o-latest
- **Foco**: 70% template + 30% criativo
- **Prompt**: [system.system.txt](prompts/system.system.txt)

### 4. KeywordAgent
- **Modelo**: gpt-4o-mini
- **Função**: Adiciona keywords em inglês para busca Unsplash
- **Prompt**: [keyword.system.txt](prompts/keyword.system.txt)

### 5. BrandAdapterAgent (OPCIONAL)
- **Modelo**: gpt-4o-mini
- **Condição**: Só roda se `input.context` existir
- **Função**: Adapta slides ao brand voice
- **Prompt**: [brandAdapter.system.txt](prompts/brandAdapter.system.txt)

### 6. CTAValidatorAgent (OPCIONAL)
- **Modelo**: gpt-4o-mini
- **Condição**: Só roda se `input.has_cta = true`
- **Função**: Garante CTA no último slide
- **Prompt**: [ctaValidator.system.txt](prompts/ctaValidator.system.txt)

### 7. DescriptionAgent
- **Modelo**: gpt-4o-mini
- **Função**: Gera descrição final do carrossel
- **Prompt**: [description.system.txt](prompts/description.system.txt)

---

## Repositórios Criados

### carouselTemplates.repo.js
```javascript
// Busca templates do Supabase
await carouselTemplatesRepo.getByName('Template 8');
await carouselTemplatesRepo.getById('uuid');
```

### userBusiness.repo.js
```javascript
// Busca brand data do Supabase
await userBusinessRepo.getByUserId('user-uuid');
await userBusinessRepo.getById('business-uuid');
```

### generatedContent.repo.js (já existia)
```javascript
// Operações atômicas no job
await generatedContentRepo.getJob(job_id);
await generatedContentRepo.claimJob(job_id); // CAS operation
await generatedContentRepo.completeJob(job_id, result);
await generatedContentRepo.failJob(job_id, error);
```

---

## Diferenças vs n8n

### Implementado ✅
- Pipeline completo de agentes
- Roteamento por content_type
- Lógica condicional (brand adapter, CTA validator)
- Blueprint de 42 chaves
- Keywords para Unsplash
- Geração de descrição

### Pendente 🔨
- Busca real de imagens no Unsplash (atualmente retorna null)
- Integração real com RocketAPI (usando mock)
- Loop de slides para aplicar imagens individuais
- Extração de vídeo do Instagram (template2 no n8n)

---

## Como Testar

### 1. Configurar .env
```bash
# Supabase
SUPABASE_URL=https://wtesihxwpbzzvkevxrjn.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# OpenAI
OPENAI_API_KEY=...

# RocketAPI
ROCKETAPI_KEY=...

# Redis
REDIS_URL=redis://localhost:6379
```

### 2. Criar job no banco
```sql
INSERT INTO carousel.generated_content (
  user_id,
  business_id,
  content_id,
  input_data,
  status,
  media_type,
  provider_type
) VALUES (
  '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
  'business-uuid',
  'content-uuid',
  '{
    "code": "DSHyK_IjvmS",
    "template": "8",
    "content_type": "cases",
    "screen_count": 10,
    "context": "Análise estratégica...",
    "has_cta": true,
    "cta_type": "comentar"
  }',
  'queued',
  8,
  'carousel-container'
);
```

### 3. Enviar para fila
```bash
POST /api/v1/jobs/enqueue
{
  "job_id": "uuid-do-job",
  "type": "instagram_carousel_v1",
  "trace_id": "test-123"
}
```

### 4. Acompanhar logs
```bash
tail -f logs/combined.log
```

---

## Próximos Passos

1. **Integrar Unsplash API** para busca real de imagens
2. **Implementar RocketAPI real** (substituir mock)
3. **Adicionar extração de vídeo** do Instagram
4. **Testar com dados reais** do Supabase
5. **Colar prompts do n8n** nos arquivos .txt

---

## Troubleshooting

### Erro: Template não encontrado
- Verificar se template existe em `carousel.templates` com nome "Template X"
- Conferir schema correto no Supabase

### Erro: Brand data não encontrado
- Verificar se user_id tem registro em `carousel.user_business`
- Brand adapter é OPCIONAL, não deve quebrar pipeline

### Erro: OpenAI timeout
- Aumentar timeout no openai.js
- Verificar rate limits da API

### Worker não processa
- Verificar conexão Redis
- Confirmar que worker está rodando (`npm run worker`)
- Checar logs de erro no BullMQ dashboard
