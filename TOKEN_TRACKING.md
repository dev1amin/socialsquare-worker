# Token Tracking Implementation

## Overview

Sistema de rastreamento de tokens de entrada/saída por agente/generator para monitorar custos de API.

## Estrutura

### Serviços Criados

1. **TokenTracker** (`src/services/tokenTracker.service.js`)
   - Coleta tokens de cada agente durante o processamento
   - Mantém contadores por agente e totais
   - Fornece métricas formatadas para salvar no banco

2. **Token Utils** (`src/shared/tokenUtils.js`)
   - `extractTokensFromCompletion()` - Extrai tokens da resposta OpenAI
   - `recordTokens()` - Helper para registrar tokens de forma simplificada

### Banco de Dados

Colunas adicionadas em `carousel.generated_content`:
- `tokens_input` (bigint) - Total de tokens de entrada
- `tokens_output` (bigint) - Total de tokens de saída
- `tokens_total` (bigint) - Total geral
- `tokens_by_agent` (jsonb) - Breakdown por agente

## Como Usar

### 1. No Orchestrator (inicializar)

```javascript
import { TokenTracker } from '../services/tokenTracker.service.js';

export class MyOrchestrator {
    constructor(jobId, traceId, tokenTracker) {
        this.jobId = jobId;
        this.traceId = traceId;
        this.tokenTracker = tokenTracker; // Passa do worker
    }

    async generate() {
        // ... seu código
    }
}
```

### 2. Em Agents/Generators (registrar tokens)

```javascript
import { recordTokens } from '../../../shared/tokenUtils.js';

export class MyGenerator {
    async generate(blueprint, htmlText, template, input) {
        // ... preparar prompts ...

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [...],
            // ... outros parâmetros
        });

        // Registrar tokens (agora automático!)
        recordTokens(this.tokenTracker, 'my_generator', completion);

        // ... processar resultado ...
        return result;
    }
}
```

### 3. No Worker (já implementado)

```javascript
const tokenTracker = createTokenTracker(job_id);

// Passa para orchestrator
const orchestrator = new NewsOrchestrator(job_id, trace_id, tokenTracker);
result = await orchestrator.generate();

// Log resumido
tokenTracker.logSummary();

// Salva no banco
await completeJob(job_id, result, null, tokenTracker.getMetrics());
```

## Exemplo de Saída

### Logs
```
[TokenTracker] Job 186 tokens: 4 agents, 15234 input tokens, 8901 output tokens, 24135 total
  - blueprint_generator: 5000 input + 3000 output = 8000 total
  - case_generator: 4234 input + 2901 output = 7135 total
  - keyword_agent: 3000 input + 2000 output = 5000 total
  - unsplash_service: 3000 input + 1000 output = 4000 total
```

### No Banco (tokens_by_agent)
```json
{
  "blueprint_generator": { "input": 5000, "output": 3000, "total": 8000 },
  "case_generator": { "input": 4234, "output": 2901, "total": 7135 },
  "keyword_agent": { "input": 3000, "output": 2000, "total": 5000 },
  "unsplash_service": { "input": 3000, "output": 1000, "total": 4000 }
}
```

## Próximos Passos

Adicione `recordTokens()` em:
- [ ] Blueprint generators (news, instagram)
- [ ] Case/Product/Story generators
- [ ] Keyword agent
- [ ] Outros agents que usam OpenAI
- [ ] Services externas se aplicável

## Notas

- TokenTracker é passado como parâmetro (não singleton) para melhor controle
- Se um agent não registrar tokens, ainda assim funciona (não quebra)
- Tokens são acumulativos por agente
- Logs automáticos ao final do job
