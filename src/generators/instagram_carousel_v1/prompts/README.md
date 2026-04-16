# Prompts do Sistema

Esta pasta contém os prompts para todos os agentes e geradores do pipeline.

## Estrutura Completa

```
prompts/
├── analyzer.system.txt              # Analisa conteúdo → gera blueprint 42 chaves
├── analyzer.user.txt
├── blueprintValidator.system.txt    # Valida/corrige blueprint
├── blueprintValidator.user.txt
├── product.system.txt               # Gerador de conteúdo: PRODUTO
├── product.user.txt
├── story.system.txt                 # Gerador de conteúdo: HISTÓRIAS
├── story.user.txt
├── case.system.txt                  # Gerador de conteúdo: CASES
├── case.user.txt
├── educational.system.txt           # Gerador de conteúdo: EDUCACIONAL
├── educational.user.txt
├── system.system.txt                # Gerador de conteúdo: SISTEMA
├── system.user.txt
├── keyword.system.txt               # Adiciona keywords para Unsplash
├── keyword.user.txt
├── brandAdapter.system.txt          # Adapta ao tom de voz da marca
└── brandAdapter.user.txt
```

## Pipeline Completo

1. **Analyzer** → Gera blueprint narrativo (42 chaves)
2. **BlueprintValidator** → Valida e corrige blueprint
3. **ContentTypeRouter** → Roteia para gerador específico:
   - ProductGenerator
   - StoryGenerator
   - CaseGenerator
   - EducationalGenerator
   - SystemGenerator
4. **KeywordAgent** → Adiciona keywords para imagens
5. **BrandAdapterAgent** → Adapta ao tom de voz
6. **CTAValidatorAgent** → Valida CTA se necessário

## Tipos de Conteúdo

### Produto
- Protagonista: o PRODUTO/SISTEMA
- Foco: argumentação estratégica, mecanismo funcional
- CTA obrigatório

### Histórias
- Narrativa ancorada para exemplificar
- História como recurso, não substituição
- Fidelidade semântica ao original

### Cases
- Leitura estratégica de fatos/decisões
- Protagonista: DECISÃO ESTRUTURAL
- Antes vs Depois

### Educacional
- Clareza operacional e leitura sistêmica
- Sem histórias, sem personagens
- Foco em mecanismos observáveis

### Sistema
- Baseado no blueprint + template
- Combina estrutura e narrativa
- 70% template + 30% criativo

## Variáveis nos Templates

Cada prompt user pode usar variáveis `{{nome}}` que são interpoladas automaticamente.

Ver código dos agentes para lista completa de variáveis disponíveis.
