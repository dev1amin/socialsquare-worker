# Carousel Worker

Worker para processar geração de conteúdo (Instagram Carousel) usando BullMQ + OpenAI.

## Arquitetura

- **Backend** enfileira jobs com `{ job_id, type, trace_id }`
- **Worker** busca dados do banco, processa com pipeline de agentes, salva result
- **Idempotência** via claim atômico (CAS)
- **No media storage**: apenas URLs do RocketAPI

## Instalação

```bash
npm install
cp .env.example .env
# Configure as variáveis de ambiente
```

## Executar

```bash
# API HTTP (recebe requests do backend)
npm start              # production
npm run dev            # development

# Worker (processa jobs da fila)
npm run worker         # production
npm run worker:dev     # development
```

## Fluxo

1. Backend calcula dedupe_key e insere em `generated_content` com status `queued`
2. Backend enfileira job mínimo: `{ job_id, type, trace_id }`
3. Worker consome job:
   - Busca dados do banco (`generated_content` + `influencer_content`)
   - Claim atômico: `queued` → `running` (CAS)
   - Pipeline OpenAI: Planner → Writer → Validator
   - Salva result e marca como `completed` ou `failed`
   - Invalida cache Redis
   - Cleanup de arquivos temp

## Pipeline de Agentes

1. **Planner**: gera outline das telas do carrossel
2. **Writer**: escreve conteúdo detalhado de cada slide + caption
3. **Validator**: valida schema e qualidade, tenta correção se necessário

## Schema Result

Ver [DOCS.md](DOCS.md) ou [result.schema.json](src/generators/instagram_carousel_v1/schemas/result.schema.json).

## Documentação Completa

Leia [DOCS.md](DOCS.md) para detalhes sobre:
- State machine
- Claim atômico
- Retry policy
- Cache invalidation
- Temp filesystem
- Estrutura de arquivos
