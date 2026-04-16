# 🔌 Integração Backend → Carousel Worker

## Resumo Executivo

O **Carousel Worker** recebe apenas o `job_id` via HTTP, busca todos os dados do Supabase e processa o carrossel em 13 etapas. O backend tem 3 responsabilidades:

1. **Criar job** na tabela `generated_content`
2. **Chamar API** do worker com `job_id`
3. **Monitorar status** do job

---

## 🚀 Início Rápido

### Opção 1: Usando o SDK (Recomendado)

```javascript
import { CarouselWorkerClient } from './carousel-worker-sdk.js';

const client = new CarouselWorkerClient({
  workerUrl: 'http://localhost:3001',
  apiSecret: process.env.WORKER_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY
});

// Gerar carrossel completo
const result = await client.generateCarousel({
  userId: '586b820b-718a-4cb5-a0b4-2a1dfd9499a6',
  businessId: 'business-uuid',
  code: 'DSHyK_IjvmS',        // Instagram shortcode
  template: '8',
  contentType: 'cases',
  screenCount: 10,
  context: 'Case de sucesso da Netflix',
  hasCta: true,
  ctaType: 'comentar',
  ctaIntention: 'produto'
});

if (result.success) {
  console.log('✅ Carrossel gerado!');
  console.log(result.result.conteudos); // Array de slides
}
```

### Opção 2: Integração Manual

#### Passo 1: Criar Job no Banco

```sql
INSERT INTO carousel.generated_content (
  id,
  user_id,
  status,
  input_data,
  generator_type,
  created_at
) VALUES (
  gen_random_uuid(),          -- UUID do job
  '586b820b-...',             -- ID do usuário
  'queued',                   -- Status inicial
  jsonb_build_object(
    'code', 'DSHyK_IjvmS',
    'template', '8',
    'content_type', 'cases',
    'screen_count', 10,
    'user_business_id', 'business-uuid',
    'context', 'Case Netflix',
    'has_cta', true,
    'cta_type', 'comentar',
    'cta_intention', 'produto'
  ),
  'instagram_carousel_v1',    -- Tipo do gerador
  now()
) RETURNING id;
```

#### Passo 2: Chamar API do Worker

```bash
curl -X POST http://localhost:3001/api/v1/jobs/enqueue \
  -H "Content-Type: application/json" \
  -H "X-API-Secret: seu-secret-aqui" \
  -d '{
    "job_id": "uuid-retornado-do-insert"
  }'
```

#### Passo 3: Monitorar Status

```bash
# Polling (a cada 2-3 segundos)
curl http://localhost:3001/api/v1/jobs/{job_id}/status \
  -H "X-API-Secret: seu-secret-aqui"
```

**Resposta quando completo:**
```json
{
  "id": "uuid-do-job",
  "status": "completed",
  "result": {
    "conteudos": [
      {
        "ordem": 1,
        "title": "Título do Slide 1",
        "subtitle": "Subtítulo",
        "keyword": "netflix",
        "imagem_fundo": null
      }
    ],
    "dados_gerais": {
      "description": "Descrição completa do carrossel...",
      "keywords": ["netflix", "streaming", "inovacao"]
    }
  },
  "created_at": "2025-01-12T10:00:00Z",
  "updated_at": "2025-01-12T10:02:30Z"
}
```

---

## 📋 Estrutura do `input_data`

### Campos Obrigatórios

| Campo | Tipo | Descrição | Exemplo |
|-------|------|-----------|---------|
| `code` | string | Shortcode do Instagram | `"DSHyK_IjvmS"` |
| `template` | string | ID do template | `"8"` |
| `content_type` | string | Tipo do conteúdo | `"cases"` |
| `screen_count` | number | Número de slides | `10` |
| `user_business_id` | string | UUID do negócio | `"business-uuid"` |

### Campos Opcionais

| Campo | Tipo | Descrição | Default |
|-------|------|-----------|---------|
| `context` | string | Contexto adicional (ativa brand adapter) | `null` |
| `has_cta` | boolean | Incluir CTA no último slide | `false` |
| `cta_type` | string | Tipo do CTA (`"comentar"`, `"visitar"`, `"seguir"`) | `null` |
| `cta_intention` | string | Intenção (`"produto"`, `"servico"`, `"engajamento"`) | `null` |

---

## 🔄 Ciclo de Vida do Job

```
┌─────────┐
│ Backend │
└────┬────┘
     │ 1. INSERT INTO generated_content
     ▼
┌─────────┐
│ queued  │ ◄── Status inicial
└────┬────┘
     │ 2. POST /api/v1/jobs/enqueue
     ▼
┌─────────┐
│ Worker  │
└────┬────┘
     │ 3. Processa pipeline (13 etapas)
     ▼
┌──────────┐
│ running  │ ◄── Worker está processando
└────┬─────┘
     │
     ├── ✅ Sucesso
     │   ▼
     │  ┌───────────┐
     │  │completed  │ ◄── result + conteudos preenchidos
     │  └───────────┘
     │
     └── ❌ Erro
         ▼
        ┌─────────┐
        │ failed  │ ◄── error_details preenchido
        └─────────┘
```

---

## 🎯 Tipos de Conteúdo

O campo `content_type` define o gerador usado:

| Tipo | Gerador | Característica |
|------|---------|----------------|
| `produto` | ProdutoGenerator | Produto como protagonista |
| `historias` | HistoriasGenerator | História como recurso narrativo |
| `cases` | CasesGenerator | Decisão estrutural |
| `educacional` | EducacionalGenerator | Clareza operacional |
| `sistema` | SistemaGenerator | Baseado no template |

---

## 🔑 Autenticação

### Desenvolvimento
```env
# .env (Backend)
CAROUSEL_WORKER_URL=http://localhost:3001
CAROUSEL_WORKER_SECRET=dev-secret-key-123
```

### Produção
```env
# .env (Backend)
CAROUSEL_WORKER_URL=https://worker.seudominio.com
CAROUSEL_WORKER_SECRET=prod-secret-strong-random-key
```

**No Worker:**
```env
# .env (Worker)
API_SECRET=dev-secret-key-123  # Mesmo valor do backend
```

---

## 🐍 Exemplo em Python

```python
import requests
import time
import uuid
from supabase import create_client

# Configuração
WORKER_URL = "http://localhost:3001"
API_SECRET = "dev-secret-key-123"
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def generate_carousel(user_id, code, template, content_type, screen_count, **kwargs):
    # 1. Criar job no banco
    input_data = {
        "code": code,
        "template": template,
        "content_type": content_type,
        "screen_count": screen_count,
        "user_business_id": kwargs.get("business_id"),
        "context": kwargs.get("context"),
        "has_cta": kwargs.get("has_cta", False),
        "cta_type": kwargs.get("cta_type"),
        "cta_intention": kwargs.get("cta_intention")
    }
    
    result = supabase.table("generated_content").insert({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "status": "queued",
        "input_data": input_data,
        "generator_type": "instagram_carousel_v1"
    }).execute()
    
    job_id = result.data[0]["id"]
    
    # 2. Enfileirar no worker
    response = requests.post(
        f"{WORKER_URL}/api/v1/jobs/enqueue",
        json={"job_id": job_id},
        headers={"X-API-Secret": API_SECRET}
    )
    response.raise_for_status()
    
    # 3. Aguardar conclusão (polling)
    max_attempts = 60  # 2 minutos (2s * 60)
    
    for attempt in range(max_attempts):
        status_response = requests.get(
            f"{WORKER_URL}/api/v1/jobs/{job_id}/status",
            headers={"X-API-Secret": API_SECRET}
        )
        
        job_status = status_response.json()
        
        if job_status["status"] == "completed":
            return {
                "success": True,
                "job_id": job_id,
                "result": job_status["result"]
            }
        
        if job_status["status"] == "failed":
            return {
                "success": False,
                "job_id": job_id,
                "error": job_status.get("error_details", {})
            }
        
        time.sleep(2)
    
    raise TimeoutError("Job não completou em 2 minutos")

# Uso
result = generate_carousel(
    user_id="586b820b-718a-4cb5-a0b4-2a1dfd9499a6",
    code="DSHyK_IjvmS",
    template="8",
    content_type="cases",
    screen_count=10,
    business_id="business-uuid",
    context="Case Netflix",
    has_cta=True,
    cta_type="comentar",
    cta_intention="produto"
)

if result["success"]:
    slides = result["result"]["conteudos"]
    print(f"✅ Gerados {len(slides)} slides")
else:
    print(f"❌ Erro: {result['error']}")
```

---

## 🔍 Monitoramento e Logs

### Logs do Worker

O worker registra cada etapa do pipeline:

```
[12:00:00] 📥 Job 1a2b3c4d recebido
[12:00:01] ⚙️  Stage 1/13: RocketAPI fetch
[12:00:05] ⚙️  Stage 2/13: Image Analysis (GPT-4O Vision)
[12:00:20] ⚙️  Stage 3/13: Blueprint Generator (42 keys)
[12:00:45] ⚙️  Stage 4/13: Blueprint Validator
[12:00:46] ⚙️  Stage 5/13: Router (type: cases)
[12:01:10] ⚙️  Stage 6/13: CasesGenerator (10 slides)
[12:01:40] ⚙️  Stage 7/13: Keywords Generator
[12:01:50] ⚙️  Stage 8/13: Brand Adapter (skipped - no context)
[12:01:50] ⚙️  Stage 9/13: CTA Validator (skipped - has_cta: false)
[12:02:00] ⚙️  Stage 10/13: Description Generator
[12:02:10] ✅ Job 1a2b3c4d completado
```

### Erros Comuns

| Erro | Causa | Solução |
|------|-------|---------|
| `Job not found` | `job_id` não existe no banco | Verificar INSERT |
| `Invalid API secret` | Secret incorreto | Verificar `.env` |
| `Template not found` | Template não existe | Criar template no Supabase |
| `Business not found` | `user_business_id` inválido | Verificar UUID |
| `Invalid content_type` | Tipo não suportado | Usar: produto, historias, cases, educacional, sistema |

---

## 📚 Documentação Adicional

- **[INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md)** - Guia completo em inglês
- **[examples/carousel-worker-sdk.js](./examples/carousel-worker-sdk.js)** - SDK JavaScript
- **[examples/usage-examples.js](./examples/usage-examples.js)** - 8 exemplos práticos
- **[PIPELINE_EXPLAINED.md](./PIPELINE_EXPLAINED.md)** - Detalhes das 13 etapas
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Arquitetura completa

---

## ⚡ Performance

- **Tempo médio**: 90-120 segundos (10 slides)
- **Gargalo**: OpenAI API (blueprint + conteúdo)
- **Timeout recomendado**: 3 minutos
- **Rate limit**: Configure no BullMQ

---

## 🛡️ Segurança

1. **Validar `user_id`** antes de criar job
2. **Usar API secret** forte em produção
3. **Rate limiting** no backend (ex: 10 jobs/usuário/hora)
4. **Validar `input_data`** antes de INSERT
5. **HTTPS** obrigatório em produção

---

## 📞 Suporte

- Problemas com pipeline: Verificar logs do worker
- Problemas com banco: Verificar Supabase logs
- Timeout constante: Aumentar timeout ou verificar OpenAI API
- Erros de autenticação: Verificar `.env` do worker e backend

---

**Última atualização**: Janeiro 2025
