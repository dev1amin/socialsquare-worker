# Pipeline de Geração de Carrossel - Explicação Detalhada

## Visão Geral do Fluxo

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT: job_id apenas                                           │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 1-4: Busca de Dados                                      │
│  • Job (generated_content)                                      │
│  • Template (carousel.templates)                                │
│  • Brand Data (carousel.user_business)                          │
│  • Instagram Data (RocketAPI)                                   │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 5: ImageAnalyzerAgent (GPT-4O Vision)                   │
│  ✓ Recebe: URLs das imagens do Instagram                       │
│  ✓ Processa: OCR + descrição visual                            │
│  ✓ Retorna: Array de slides com texto extraído + descrição     │
│                                                                  │
│  Formato de saída:                                              │
│  [                                                               │
│    {                                                             │
│      slide: 1,                                                   │
│      texto: "PARE DE PROCRASTINAR\n\nDica #1",                 │
│      descrição: "Fundo azul, texto em negrito centralizado"    │
│    },                                                            │
│    { slide: 2, texto: "...", descrição: "..." }                │
│  ]                                                               │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 6: AnalyzerAgent (GPT-4O)                               │
│  ✓ Recebe: resultado do ImageAnalyzer                          │
│  ✓ Processa: análise semântica profunda                        │
│  ✓ Retorna: Blueprint com 42 chaves                            │
│                                                                  │
│  Chaves do Blueprint:                                           │
│  • tema_central, mensagem_principal                            │
│  • estrutura_narrativa, tom_de_voz                             │
│  • gancho_de_abertura, ponto_de_virada                         │
│  • mecanismo_retorico, driver_psicologico                      │
│  • ... (total: 42 chaves)                                       │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 7: BlueprintValidatorAgent (GPT-4O)                     │
│  ✓ Recebe: blueprint bruto                                     │
│  ✓ Processa: validação das microgramáticas                     │
│  ✓ Retorna: blueprint corrigido                                │
│                                                                  │
│  Valida:                                                        │
│  • Máximo 16 palavras por campo                                │
│  • Nominalização (sem verbos principais)                       │
│  • Especificidade (não genérico)                               │
│  • Aderência às microgramáticas por categoria                  │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 8: ContentTypeRouter (SWITCH)                           │
│                                                                  │
│  content_type = ?                                               │
│                                                                  │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐    │
│  │ produto  │historias │  cases   │educacional│ sistema │    │
│  └────┬─────┴────┬─────┴────┬─────┴────┬─────┴────┬─────┘    │
│       ↓          ↓          ↓          ↓          ↓           │
│   Product    Story      Case    Educational  System           │
│  Generator  Generator Generator  Generator  Generator          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  GERADOR ESPECÍFICO (chatgpt-4o-latest)                        │
│                                                                  │
│  Recebe:                                                        │
│  • blueprint validado                                           │
│  • template do Supabase                                         │
│  • context do usuário                                           │
│  • screen_count                                                 │
│                                                                  │
│  Retorna:                                                       │
│  • Array de slides: [{ title, subtitle }]                      │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 9: KeywordAgent (GPT-4O-Mini)                           │
│  ✓ Adiciona keyword em inglês para cada slide                  │
│  ✓ Keywords são usadas para busca no Unsplash                  │
│                                                                  │
│  Retorna:                                                       │
│  [{ title, subtitle, keyword: "entrepreneur laptop" }]         │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 10: BrandAdapterAgent (GPT-4O-Mini) [OPCIONAL]         │
│  ✓ Condição: só roda se input.context existir                 │
│  ✓ Adapta slides ao tom de voz da marca                        │
│  ✓ Usa brand_positioning, voice_tone, target_audience          │
│                                                                  │
│  Se context não existir → PULA ESTA ETAPA                      │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 11: CTAValidatorAgent (GPT-4O-Mini) [OPCIONAL]         │
│  ✓ Condição: só roda se input.has_cta = true                  │
│  ✓ Garante presença de CTA no último slide                     │
│  ✓ Valida alinhamento com cta_type e cta_intention             │
│                                                                  │
│  Se has_cta = false → PULA ESTA ETAPA                          │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 12: DescriptionAgent (GPT-4O-Mini)                      │
│  ✓ Gera descrição final do carrossel                           │
│  ✓ Baseada nos slides finais + brand data                      │
│  ✓ Respeita tom de voz e posicionamento                        │
└─────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────┐
│  ETAPA 13: Monta Resultado Final                               │
│  {                                                               │
│    dados_gerais: { nome, arroba, foto_perfil, description },   │
│    conteudos: [{ title, subtitle, keyword, imagem_fundo }],    │
│    metadata: { blueprint, content_type, ... }                   │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. ImageAnalyzerAgent - Análise Visual (NOVO!)

### Responsabilidade
Primeiro agente do pipeline. Realiza OCR + descrição visual das imagens do carrossel usando GPT-4O Vision.

### Modelo
- **GPT-4O** (com vision)
- **max_tokens**: 2500
- **detail**: low (economiza tokens)

### Input
```javascript
{
  imageUrls: [
    "https://instagram.com/image1.jpg",
    "https://instagram.com/image2.jpg",
    ...
  ]
}
```

### Output
```javascript
[
  {
    slide: 1,
    texto: "PARE DE PROCRASTINAR\n\nDica #1 para produtividade",
    descrição: "Fundo azul escuro, texto em branco centralizado, ícone de relógio no canto"
  },
  {
    slide: 2,
    texto: "Divida grandes tarefas\nem pequenas partes",
    descrição: "Fundo gradiente azul-roxo, lista com checkboxes"
  }
]
```

### Características
- **Não inventa nada** que não está na imagem
- **Preserva formatação**: quebras de linha, maiúsculas, emojis
- **Ignora UI do Instagram**: nome de perfil, curtidas, etc.
- **Descreve sem julgar**: só fatos visuais

---

## 2. ContentTypeRouter - O Switch

### Como Funciona

O router é um **switch pattern** que seleciona o gerador apropriado baseado no `content_type`:

```javascript
// ContentTypeRouter mantém um mapa de geradores
this.generators = {
  produto: new ProductGenerator(),
  historias: new StoryGenerator(),
  cases: new CaseGenerator(),
  educacional: new EducationalGenerator(),
  sistema: new SystemGenerator()
};

// No método route(), faz o switch
async route({ content_type, blueprint, template, context, screen_count }) {
  const generator = this.generators[content_type];
  
  if (!generator) {
    throw new Error(`Unknown content_type: ${content_type}`);
  }
  
  return await generator.generate({
    blueprint,
    template,
    context,
    screen_count
  });
}
```

### Geradores Disponíveis

#### 2.1. ProductGenerator
**Quando usar**: `content_type: "produto"`

**Foco**: Produto/sistema como protagonista  
**Modelo**: chatgpt-4o-latest  
**Estrutura obrigatória**:
- Pattern break inicial
- Problema comum (abordagem errada)
- **Reenquadramento** (por que o mercado erra)
- Fundamento técnico
- **Mecanismo explícito** (o que o produto faz)
- **Sistema nomeado** (3 sinais, 4 filtros...)
- Prova lógica
- CTA claro

**Prompt**: [product.system.txt](src/generators/instagram_carousel_v1/prompts/product.system.txt)

---

#### 2.2. StoryGenerator
**Quando usar**: `content_type: "historias"`

**Foco**: História como recurso narrativo  
**Modelo**: chatgpt-4o-latest  
**Características**:
- História serve para **exemplificar**, não substituir conteúdo
- Deve haver slide explícito mostrando que história ilustra o tema
- **Proibido**: fanfic gratuita, heroísmo caricato, métricas inventadas
- Encerramento: narrativo/reflexivo, nunca instrucional

**Prompt**: [story.system.txt](src/generators/instagram_carousel_v1/prompts/story.system.txt)

---

#### 2.3. CaseGenerator
**Quando usar**: `content_type: "cases"`

**Foco**: Decisão estrutural como protagonista  
**Modelo**: chatgpt-4o-latest  
**Estrutura obrigatória**:
1. Fato chocante (evento verificável)
2. Contexto + credibilidade
3. **Virada estrutural** (antes vs depois)
4. Interpretação estratégica
5. Tradução para princípio de negócio
6. Aplicação/CTA educacional

**Travás críticas**:
- **Concretude obrigatória**: mínimo 2 elementos específicos
- **Proibição de mono-causa**: não atribuir sucesso a uma única causa
- **Teste do nome próprio**: se remover nomes, raciocínio deve fazer sentido

**Prompt**: [case.system.txt](src/generators/instagram_carousel_v1/prompts/case.system.txt)

---

#### 2.4. EducationalGenerator
**Quando usar**: `content_type: "educacional"`

**Foco**: Clareza operacional, sem histórias  
**Modelo**: chatgpt-4o-latest  
**Estrutura obrigatória**:
1. Reenquadramento (problema não está onde pensam)
2. Definição operacional (utilizável, não filosófica)
3. **Mecanismo** (como problema se manifesta)
4. Padrão observável
5. Erro comum de gestão
6. Critério correto
7. Consolidação + CTA cognitivo

**Proibições absolutas**:
- ❌ Histórias, personagens, empresas, cases
- ❌ Abstrações sem mecanismo ("impacta", "prejudica"...)
- ❌ Listas genéricas

**Regra de mecanismo**: Para cada slide, deve ficar claro "O que exatamente quebra?"

**Prompt**: [educational.system.txt](src/generators/instagram_carousel_v1/prompts/educational.system.txt)

---

#### 2.5. SystemGenerator
**Quando usar**: `content_type: "sistema"`

**Foco**: 70% template + 30% criativo  
**Modelo**: chatgpt-4o-latest  
**Características**:
- Usa blueprint como **guia temático**
- Respeita **ritmo e estrutura** do template
- Mantém coerência narrativa slide a slide

**Prompt**: [system.system.txt](src/generators/instagram_carousel_v1/prompts/system.system.txt)

---

## Fluxo de Dados Entre Etapas

### 1. RocketAPI → ImageAnalyzer
```javascript
// RocketAPI retorna
{
  shortcode: "DSHyK_IjvmS",
  imageUrls: [
    "https://instagram.com/img1.jpg",
    "https://instagram.com/img2.jpg"
  ]
}

// ImageAnalyzer processa
const imageAnalysis = await imageAnalyzer.analyze({ imageUrls });
```

### 2. ImageAnalyzer → Analyzer
```javascript
// ImageAnalyzer retorna
[
  { slide: 1, texto: "...", descrição: "..." },
  { slide: 2, texto: "...", descrição: "..." }
]

// Analyzer usa para gerar blueprint
const blueprint = await analyzer.analyze({ 
  imageAnalysis,
  context: "..." 
});
```

### 3. Analyzer → BlueprintValidator
```javascript
// Blueprint bruto (pode ter erros)
{
  tema_central: "procrastinação",
  mensagem_principal: "dividir tarefas...",
  // ... 42 chaves
}

// Validator corrige e retorna blueprint validado
const validatedBlueprint = await validator.validate(blueprint);
```

### 4. BlueprintValidator → ContentTypeRouter
```javascript
// Router seleciona gerador baseado no content_type
const slides = await router.route({
  content_type: "cases", // ou produto, historias, educacional, sistema
  blueprint: validatedBlueprint,
  template: templateData,
  context: "...",
  screen_count: 10
});

// Retorna slides gerados
[
  { title: "...", subtitle: "..." },
  { title: "...", subtitle: "..." }
]
```

### 5. Generator → KeywordAgent
```javascript
// Adiciona keywords em inglês
const slidesWithKeywords = await keywordAgent.addKeywords({
  slides,
  slidesCount: 10
});

// Retorna
[
  { title: "...", subtitle: "...", keyword: "entrepreneur laptop" },
  { title: "...", subtitle: "...", keyword: "team collaboration" }
]
```

### 6. KeywordAgent → BrandAdapter (OPCIONAL)
```javascript
// SÓ RODA SE input.context EXISTIR
if (input.context && brandData) {
  adaptedSlides = await brandAdapter.adapt({
    slides: slidesWithKeywords,
    brandData,
    context: input.context
  });
}
```

### 7. BrandAdapter → CTAValidator (OPCIONAL)
```javascript
// SÓ RODA SE input.has_cta = true
if (input.has_cta) {
  adaptedSlides = await ctaValidator.validate({
    slides: adaptedSlides,
    cta_type: "comentar",
    cta_intention: "produto"
  });
}
```

### 8. CTAValidator → DescriptionAgent
```javascript
// Gera descrição final
const description = await descriptionAgent.generate({
  slides: adaptedSlides,
  brandData,
  context: input.context
});
```

---

## Resumo das Mudanças

### ✅ Antes (incompleto)
```
RocketAPI → Analyzer → Blueprint → Generator → Keywords → ...
```

### ✅ Agora (completo, seguindo n8n)
```
RocketAPI → ImageAnalyzer → Analyzer → Blueprint → Router → Generator → Keywords → Brand → CTA → Description
```

### Novo Agente Criado
- **ImageAnalyzerAgent** ([imageAnalyzer.agent.js](src/generators/instagram_carousel_v1/agents/imageAnalyzer.agent.js))
  - Usa GPT-4O Vision
  - Faz OCR + descrição visual
  - Retorna array estruturado

### Ajustes Feitos
- **AnalyzerAgent** agora recebe `imageAnalysis` em vez de `instagramData`
- **Orchestrator** adicionou etapa 5 (ImageAnalyzer) antes do Analyzer
- Pipeline agora tem **13 etapas** (antes tinha 11)

---

## Como Testar ImageAnalyzer

```javascript
import { ImageAnalyzerAgent } from './agents/imageAnalyzer.agent.js';

const analyzer = new ImageAnalyzerAgent();

const result = await analyzer.analyze({
  imageUrls: [
    'https://example.com/slide1.jpg',
    'https://example.com/slide2.jpg'
  ]
});

console.log(result);
// [
//   { slide: 1, texto: "...", descrição: "..." },
//   { slide: 2, texto: "...", descrição: "..." }
// ]
```
