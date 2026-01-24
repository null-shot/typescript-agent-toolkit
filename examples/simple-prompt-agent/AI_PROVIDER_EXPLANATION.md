# 🤖 AI_PROVIDER vs API Keys - Объяснение

## Разница

### `AI_PROVIDER` - Выбор провайдера
Это **строка**, которая указывает **какой AI провайдер использовать**:
- `anthropic` - Claude (Anthropic)
- `openai` - GPT (OpenAI)
- `deepseek` - DeepSeek
- `workers-ai` - Cloudflare Workers AI
- `gemini` - Google Gemini
- `grok` - xAI Grok

### `ANTHROPIC_API_KEY` - API ключ для конкретного провайдера
Это **API ключ** для доступа к Anthropic API.

## Как это работает

В коде агента (`src/index.ts`):

```typescript
switch (env.AI_PROVIDER) {
  case 'anthropic':
    provider = createAnthropic({
      apiKey: env.ANTHROPIC_API_KEY,  // ← Используется ключ Anthropic
    });
    model = provider.languageModel('claude-3-haiku-20240307');
    break;
    
  case 'openai':
    provider = createOpenAI({
      apiKey: env.OPEN_AI_API_KEY,  // ← Используется ключ OpenAI
    });
    model = provider.languageModel('gpt-3.5-turbo');
    break;
    
  case 'deepseek':
    provider = createDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY,  // ← Используется ключ DeepSeek
    });
    model = provider.languageModel('deepseek-chat');
    break;
    
  // ... и т.д.
}
```

## Примеры

### Пример 1: Использование Anthropic (Claude)
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-...
```
- `AI_PROVIDER` говорит: "используй Anthropic"
- `ANTHROPIC_API_KEY` - ключ для доступа к Anthropic API

### Пример 2: Использование OpenAI (GPT)
```env
AI_PROVIDER=openai
OPEN_AI_API_KEY=sk-...
```
- `AI_PROVIDER` говорит: "используй OpenAI"
- `OPEN_AI_API_KEY` - ключ для доступа к OpenAI API

### Пример 3: Использование Cloudflare Workers AI
```env
AI_PROVIDER=workers-ai
# API ключ не нужен! Используется binding из wrangler.jsonc
```
- `AI_PROVIDER` говорит: "используй Workers AI"
- API ключ не нужен, используется Cloudflare binding

## Зачем это нужно?

Это **кастомная настройка агента**, которая позволяет:

1. **Легко переключаться между провайдерами** - просто измените `AI_PROVIDER`
2. **Использовать разные ключи** - каждый провайдер имеет свой API ключ
3. **Не хранить все ключи** - нужен только ключ для выбранного провайдера

## В production

При деплое нужно установить:

```bash
# 1. Выбрать провайдера
wrangler secret put AI_PROVIDER
# Введите: anthropic (или openai, deepseek, и т.д.)

# 2. Установить ключ для выбранного провайдера
# Если выбрали anthropic:
wrangler secret put ANTHROPIC_API_KEY
# Введите: sk-ant-api03-...

# Если выбрали openai:
wrangler secret put OPEN_AI_API_KEY
# Введите: sk-...
```

## Итого

- **`AI_PROVIDER`** = "Какой провайдер использовать?" (строка: anthropic, openai, и т.д.)
- **`ANTHROPIC_API_KEY`** = "Ключ для доступа к Anthropic API" (если выбрали anthropic)
- **`OPEN_AI_API_KEY`** = "Ключ для доступа к OpenAI API" (если выбрали openai)
- И так далее для каждого провайдера

**Это НЕ одно и то же!** `AI_PROVIDER` - это выбор, а `ANTHROPIC_API_KEY` - это ключ для конкретного провайдера.
