# Guia de Integração - Backend → Carousel Worker

## Visão Geral

O Carousel Worker usa o padrão **minimal payload**: o backend envia apenas o `job_id`, e o worker busca todos os dados necessários do banco.

```
Backend                    Worker
   │                         │
   ├─1. Cria job no banco───→│
   │   (generated_content)   │
   │                         │
   ├─2. Envia job_id────────→│
   │   (HTTP POST)           │
   │                         │
   │   ┌───────────────────┐ │
   │   │ Worker processa   │ │
   │   │ busca dados do DB │ │
   │   └───────────────────┘ │
   │                         │
   │←─3. Resultado no banco──┤
   │   (result field)        │
```

---

## Passo 1: Criar Job no Banco (Backend)

**Antes de chamar o worker**, o backend deve criar um registro na tabela `carousel.generated_content`:

```sql
INSERT INTO carousel.generated_content (
  id,
  user_id,
  business_id,
  content_id,
  input_data,
  status,
  media_type,
  provider_type,
  created_at
) VALUES (
  gen_random_uuid(),           -- id (será o job_id)
  $1,                          -- user_id
  $2,                          -- business_id
  $3,                          -- content_id (opcional)
  $4,                          -- input_data (JSON - ver estrutura abaixo)
  'queued',                    -- status inicial
  8,                           -- media_type (carrossel)
  'carousel-container',        -- provider_type
  NOW()
) RETURNING id;
```

### Estrutura do `input_data` (JSON)

```json
{
  "code": "DSHyK_IjvmS",           // Shortcode do Instagram
  "template": "8",                  // Número do template (1-10)
  "content_type": "cases",          // produto | historias | cases | educacional | sistema
  "screen_count": 10,               // Número de slides
  "dimension": "1170x1560",         // Dimensão do carrossel
  "context": "Análise estratégica de decisões...", // Contexto adicional (OPCIONAL)
  "has_cta": true,                  // Se deve ter CTA
  "cta_type": "comentar",           // comentar | salvar | compartilhar | visitar
  "cta_intention": "produto",       // produto | engajamento | educacional
  "description_length": "curta"     // curta | media | longa
}
```

### Campos Obrigatórios
- ✅ `code` - shortcode do post do Instagram
- ✅ `template` - número do template (string "1" a "10")
- ✅ `content_type` - tipo de conteúdo
- ✅ `screen_count` - quantidade de slides

### Campos Opcionais
- `context` - contexto adicional (se não existir, pula brand adapter)
- `has_cta` - default: false
- `cta_type` - só necessário se has_cta=true
- `cta_intention` - só necessário se has_cta=true
- `dimension` - default: "1170x1560"
- `description_length` - default: "curta"

---

## Passo 2: Enviar Job para o Worker

### Endpoint
```
POST http://localhost:3001/api/v1/jobs/enqueue
```

### Headers
```
Content-Type: application/json
Authorization: Bearer <INTERNAL_API_SECRET>
```

### Payload (Minimal)
```json
{
  "job_id": "uuid-do-registro-criado-no-banco",
  "type": "instagram_carousel_v1",
  "trace_id": "optional-trace-id-for-logging"
}
```

### Exemplo cURL
```bash
curl -X POST http://localhost:3001/api/v1/jobs/enqueue \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-secret-aqui" \
  -d '{
    "job_id": "123e4567-e89b-12d3-a456-426614174000",
    "type": "instagram_carousel_v1",
    "trace_id": "req-abc-123"
  }'
```

### Resposta de Sucesso (202 Accepted)
```json
{
  "success": true,
  "job_id": "1",
  "message": "Job enqueued successfully"
}
```

### Resposta de Erro (500)
```json
{
  "error": "Failed to enqueue job",
  "message": "Job not found in database"
}
```

---

## Passo 3: Acompanhar Progresso

O worker atualiza automaticamente o campo `status` na tabela `generated_content`:

### Estados do Job

| Status | Significado |
|--------|-------------|
| `queued` | Job criado, aguardando processamento |
| `running` | Worker está processando |
| `completed` | Concluído com sucesso, `result` preenchido |
| `failed` | Falhou, `error` preenchido |

### Query para Acompanhar
```sql
SELECT 
  id,
  status,
  result,
  error,
  created_at,
  updated_at
FROM carousel.generated_content
WHERE id = $1;
```

### Resultado Final (quando status = 'completed')

O campo `result` será um JSON com esta estrutura:

```json
{
  "dados_gerais": {
    "nome": "Workez AI",
    "arroba": "workez.ai",
    "foto_perfil": "https://...",
    "template": "8",
    "description": "Descrição gerada pelo agente..."
  },
  "conteudos": [
    {
      "title": "Como a Netflix dominou o streaming",
      "subtitle": "Decisão que mudou tudo em 2007",
      "keyword": "netflix office",
      "imagem_fundo": null,
      "imagem_fundo2": null,
      "imagem_fundo3": null
    },
    {
      "title": "O problema estava no modelo de negócio",
      "subtitle": "Locadoras cobravam por título, não por tempo",
      "keyword": "video rental store",
      "imagem_fundo": null,
      "imagem_fundo2": null,
      "imagem_fundo3": null
    }
  ],
  "metadata": {
    "generator_version": "instagram_carousel_v1",
    "content_type": "cases",
    "blueprint": { /* 42 chaves */ },
    "generated_at": "2025-12-26T12:00:00.000Z",
    "user_id": "...",
    "business_id": "..."
  }
}
```

---

## Exemplo Completo (Node.js + Supabase)

```javascript
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Cria job de geração de carrossel
 */
async function createCarouselJob(userId, businessId, inputData) {
  try {
    // 1. Criar job no banco
    const { data: job, error } = await supabase
      .from('generated_content')
      .insert({
        user_id: userId,
        business_id: businessId,
        input_data: inputData,
        status: 'queued',
        media_type: 8,
        provider_type: 'carousel-container'
      })
      .select()
      .single();

    if (error) throw error;

    console.log('Job criado:', job.id);

    // 2. Enfileirar no worker
    const response = await axios.post(
      'http://localhost:3001/api/v1/jobs/enqueue',
      {
        job_id: job.id,
        type: 'instagram_carousel_v1',
        trace_id: `user-${userId}-${Date.now()}`
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.INTERNAL_API_SECRET}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Job enfileirado:', response.data);

    return {
      job_id: job.id,
      status: 'queued'
    };
  } catch (error) {
    console.error('Erro ao criar job:', error);
    throw error;
  }
}

/**
 * Aguarda conclusão do job
 */
async function waitForJobCompletion(jobId, maxAttempts = 60, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const { data: job } = await supabase
      .from('generated_content')
      .select('status, result, error')
      .eq('id', jobId)
      .single();

    if (job.status === 'completed') {
      return { success: true, result: job.result };
    }

    if (job.status === 'failed') {
      return { success: false, error: job.error };
    }

    // Aguarda intervalo antes de checar novamente
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error('Job timeout');
}

// Uso
async function main() {
  const inputData = {
    code: 'DSHyK_IjvmS',
    template: '8',
    content_type: 'cases',
    screen_count: 10,
    context: 'Análise estratégica de como a Netflix mudou o mercado',
    has_cta: true,
    cta_type: 'comentar',
    cta_intention: 'produto'
  };

  // Criar e enfileirar job
  const { job_id } = await createCarouselJob(
    'user-uuid',
    'business-uuid',
    inputData
  );

  console.log('Aguardando processamento...');

  // Aguardar conclusão
  const result = await waitForJobCompletion(job_id);

  if (result.success) {
    console.log('Carrossel gerado com sucesso!');
    console.log('Slides:', result.result.conteudos.length);
  } else {
    console.error('Erro na geração:', result.error);
  }
}

main().catch(console.error);
```

---

## Exemplo Completo (Python + Supabase)

```python
import os
import time
import requests
from supabase import create_client, Client

supabase: Client = create_client(
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
)

def create_carousel_job(user_id: str, business_id: str, input_data: dict):
    """Cria job de geração de carrossel"""
    
    # 1. Criar job no banco
    job = supabase.table('generated_content').insert({
        'user_id': user_id,
        'business_id': business_id,
        'input_data': input_data,
        'status': 'queued',
        'media_type': 8,
        'provider_type': 'carousel-container'
    }).execute()
    
    job_id = job.data[0]['id']
    print(f'Job criado: {job_id}')
    
    # 2. Enfileirar no worker
    response = requests.post(
        'http://localhost:3001/api/v1/jobs/enqueue',
        json={
            'job_id': job_id,
            'type': 'instagram_carousel_v1',
            'trace_id': f'user-{user_id}-{int(time.time())}'
        },
        headers={
            'Authorization': f'Bearer {os.environ.get("INTERNAL_API_SECRET")}',
            'Content-Type': 'application/json'
        }
    )
    
    response.raise_for_status()
    print(f'Job enfileirado: {response.json()}')
    
    return job_id

def wait_for_job_completion(job_id: str, max_attempts: int = 60, interval_seconds: int = 2):
    """Aguarda conclusão do job"""
    
    for _ in range(max_attempts):
        job = supabase.table('generated_content')\
            .select('status, result, error')\
            .eq('id', job_id)\
            .single()\
            .execute()
        
        if job.data['status'] == 'completed':
            return {'success': True, 'result': job.data['result']}
        
        if job.data['status'] == 'failed':
            return {'success': False, 'error': job.data['error']}
        
        time.sleep(interval_seconds)
    
    raise TimeoutError('Job timeout')

# Uso
if __name__ == '__main__':
    input_data = {
        'code': 'DSHyK_IjvmS',
        'template': '8',
        'content_type': 'cases',
        'screen_count': 10,
        'context': 'Análise estratégica de como a Netflix mudou o mercado',
        'has_cta': True,
        'cta_type': 'comentar',
        'cta_intention': 'produto'
    }
    
    job_id = create_carousel_job('user-uuid', 'business-uuid', input_data)
    
    print('Aguardando processamento...')
    result = wait_for_job_completion(job_id)
    
    if result['success']:
        print('Carrossel gerado com sucesso!')
        print(f'Slides: {len(result["result"]["conteudos"])}')
    else:
        print(f'Erro na geração: {result["error"]}')
```

---

## Variáveis de Ambiente Necessárias

### Backend (quem envia)
```bash
# Worker API
CAROUSEL_WORKER_URL=http://localhost:3001
CAROUSEL_WORKER_SECRET=seu-secret-compartilhado

# Supabase
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

### Worker (quem recebe)
```bash
# API Config
PORT=3001
INTERNAL_API_SECRET=seu-secret-compartilhado

# Supabase
SUPABASE_URL=https://....supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Redis
REDIS_URL=redis://localhost:6379

# OpenAI
OPENAI_API_KEY=sk-...

# RocketAPI
ROCKETAPI_KEY=...
```

---

## Fluxo de Estados

```
┌─────────┐
│ queued  │ ← Backend cria job
└────┬────┘
     │
     ↓ Worker claim atômico (CAS)
┌─────────┐
│ running │
└────┬────┘
     │
     ├─→ Sucesso ──→ ┌───────────┐
     │               │ completed │
     │               └───────────┘
     │
     └─→ Erro ─────→ ┌─────────┐
                     │ failed  │
                     └─────────┘
```

---

## Tratamento de Erros

### Backend deve tratar:
- ❌ Falha ao criar job no banco
- ❌ Falha ao chamar API do worker
- ❌ Timeout ao aguardar conclusão

### Worker trata automaticamente:
- ✅ Job não encontrado
- ✅ Job já processado (idempotência)
- ✅ Erros de OpenAI (retry automático)
- ✅ Erros de RocketAPI (retry automático)

---

## Checklist de Integração

- [ ] Criar tabela `carousel.generated_content` no Supabase
- [ ] Criar tabela `carousel.templates` com templates
- [ ] Criar tabela `carousel.user_business` com dados de marca
- [ ] Configurar variáveis de ambiente no backend
- [ ] Configurar variáveis de ambiente no worker
- [ ] Implementar função de criação de job no backend
- [ ] Implementar chamada HTTP para enfileirar job
- [ ] Implementar polling ou webhook para receber resultado
- [ ] Testar fluxo completo end-to-end

---

## Monitoramento

### Logs do Worker
```bash
tail -f logs/combined.log
```

### Redis (BullMQ Dashboard)
```bash
npm run queue:ui
# Acesse http://localhost:3002
```

### Métricas Úteis
- Tempo médio de processamento por job
- Taxa de sucesso/falha
- Jobs em fila (waiting)
- Jobs em processamento (active)
- Jobs completados (completed)
- Jobs falhados (failed)
