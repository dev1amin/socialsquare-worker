# Carousel Worker - Documentation

Worker redesenhado seguindo arquitetura de **claim atômico**, **idempotência** e **pipeline de agentes OpenAI**.

## Arquitetura

### Princípios

1. **Backend enfileira, Worker processa**: Backend cria registro no banco e enfileira `{ job_id, type, trace_id }`
2. **Payload mínimo**: Worker recebe apenas ponteiro (job_id), busca tudo do banco
3. **Claim atômico**: CAS (Compare-And-Set) garante que apenas 1 worker processa cada job
4. **Idempotência**: Se BullMQ duplicar, worker detecta e ignora
5. **No media storage**: Mídia do RocketAPI nunca é salva, apenas URLs
6. **Determinístico**: Baseado no estado do banco, não no payload da fila

### State Machine

```
queued → running → completed
              ↘ failed
```

Transições válidas:
- `queued → running` (via claim atômico)
- `running → completed` (sucesso)
- `running → failed` (erro permanente ou tentativas esgotadas)

## Fluxo Completo

1. **BullMQ recebe**: `{ job_id: 123, type: "instagram_carousel_v1", trace_id: "optional" }`
2. **Worker busca**: `SELECT * FROM generated_content WHERE id = 123`
3. **Verifica status**: Se `completed|failed|running` → ACK e sai
4. **Claim atômico**: `UPDATE ... SET status='running' WHERE id=123 AND status='queued'`
5. **Busca content**: `SELECT * FROM influencer_content WHERE id = content_id`
6. **Pipeline de geração**:
   - RocketAPI: metadata + URLs
   - Planner: outline das telas
   - Writer: conteúdo de cada slide
   - Validator: schema + qualidade
7. **Persiste**: `UPDATE ... SET status='completed', result=... WHERE id=123`
8. **Invalida cache**: Redis keys relacionadas
9. **Cleanup**: Remove `/tmp/carousel/123/`
10. **ACK**

## Estrutura de Arquivos

```
worker/
├── src/
│   ├── config/                 # env, logger, redis, supabase, openai
│   ├── db/                     # repos (generatedContent, influencerContent)
│   ├── services/               # rocketapi, cache, tempfs
│   ├── http/                   # API HTTP (middleware, routes, controllers)
│   ├── queue/                  # BullMQ (queue, worker, utils)
│   ├── generators/
│   │   └── instagram_carousel_v1/
│   │       ├── orchestrator.js
│   │       ├── agents/         # planner, writer, validator
│   │       ├── schemas/        # result.schema.json
│   │       └── prompts/        # .txt files (TODO)
│   └── shared/                 # errors, hash, canonicalJson
├── package.json
├── .env.example
└── README.md
```

## Schema do Result

Ver: [result.schema.json](src/generators/instagram_carousel_v1/schemas/result.schema.json)

```json
{
  "generator_version": "instagram_carousel_v1",
  "content_id": 123,
  "template": "8",
  "dimension": "1170x1560",
  "screen_count": 10,
  "slides": [...],
  "caption": "...",
  "hashtags": [...],
  "sources": { "rocket": { ... } },
  "metadata": { ... }
}
```

## Pipeline de Agentes

### 1. PlannerAgent
- **Input**: `input` (normalizado), `content` (post original), `rocketData`
- **Output**: Outline com títulos e tópicos de cada slide
- **Prompt**: Define estrutura geral do carrossel

### 2. WriterAgent
- **Input**: Plan do Planner
- **Output**: Conteúdo completo (title, body, CTA) + caption + hashtags
- **Prompt**: Copywriting detalhado

### 3. ValidatorAgent
- **Input**: Draft do Writer
- **Output**: Validado e corrigido (se necessário)
- **Lógica**:
  - Valida schema estrutural
  - Detecta issues de qualidade (slides vazios, muito curtos)
  - Tenta correção (1x) com OpenAI
  - Se falhar: erro permanente (não retry)

## Retry Policy

- **Attempts**: 2-3 (configurável)
- **Backoff**: Exponencial (10s, 30s, 90s)
- **Retry somente se**:
  - Timeout RocketAPI
  - 429 OpenAI (rate limit)
  - Erro de rede transitório
- **Nunca retry se**:
  - Schema inválido após correção
  - Content sem code (bug upstream)
  - Validação falhou permanentemente

## Temp Filesystem

- **Diretório base**: `/tmp/carousel/`
- **Por job**: `/tmp/carousel/<job_id>/`
- **Cleanup**: Sempre no `finally`, mesmo se crash
- **Janitor**: No startup, remove dirs > 60min

## Cache Invalidation

Após `completed` ou `failed`:
- `generated_content:id:<job_id>`
- `generated_content:list:<user_id>:<business_id>`

## Secrets (.env)

```bash
NODE_ENV=production
REDIS_URL=redis://...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=sk-...
ROCKETAPI_KEY=...
QUEUE_NAME=generated-content
WORKER_CONCURRENCY=5
JOB_ATTEMPTS=2
TEMP_DIR=/tmp/carousel
```

## Executar

```bash
# Instalar dependências
npm install

# Configurar .env
cp .env.example .env

# API HTTP (recebe requests do backend)
npm start

# Worker (processa jobs)
npm run worker

# Development
npm run dev
npm run worker:dev
```

## Definition of Done

- [x] Consumidor BullMQ rodando
- [x] Claim atômico (CAS)
- [x] Pipeline OpenAI (Planner/Writer/Validator)
- [x] Schema result padronizado
- [x] Cache invalidation
- [x] Temp filesystem + janitor
- [x] Logs estruturados (job_id, trace_id, stage)
- [ ] Prompts em arquivos `.txt` (TODO)
- [ ] Integração real RocketAPI (mock atual)
- [ ] Testes de integração

## Próximos Passos

1. Implementar chamada real do RocketAPI
2. Criar prompts em arquivos `.txt` separados
3. Ajustar modelos OpenAI por uso (gpt-4 vs gpt-3.5)
4. Monitoramento e métricas (Prometheus?)
5. Testes de carga
