# 🚀 Деплой Telegram бота на Cloudflare Workers

## Обзор архитектуры

```
┌─────────────────────────────────────────┐
│  Cloudflare Workers (Production)        │
├─────────────────────────────────────────┤
│                                         │
│  1. Simple Prompt Agent                 │
│     https://simple-prompt-agent.        │
│         workers.dev                     │
│                                         │
│  2. Telegram Bot Agent                  │
│     https://telegram-bot-agent.         │
│         workers.dev                     │
│     └─> Webhook: /webhook               │
│                                         │
└─────────────────────────────────────────┘
           │
           │ HTTP
           ▼
┌─────────────────────────────────────────┐
│  Telegram API                           │
│  (api.telegram.org)                     │
└─────────────────────────────────────────┘
```

## 📋 План деплоя

### Шаг 1: Деплой агента (Simple Prompt Agent)

```bash
cd examples/simple-prompt-agent
```

#### 1.1. Настройка секретов

```bash
# Установить API ключи для AI провайдера
wrangler secret put ANTHROPIC_API_KEY
# Введите значение: sk-ant-api03-...

# Или для OpenAI
wrangler secret put OPEN_AI_API_KEY
# Введите значение: sk-...

# Настроить провайдера
wrangler secret put AI_PROVIDER
# Введите: anthropic (или openai, deepseek, и т.д.)
```

#### 1.2. Деплой агента

```bash
pnpm deploy
# или
wrangler deploy
```

**Результат:**
```
✨ Deployed to https://simple-prompt-agent.workers.dev
```

**Сохраните этот URL!** Он понадобится для настройки бота.

#### 1.3. Проверка агента

```bash
curl https://simple-prompt-agent.workers.dev/
```

Должен вернуть JSON с метаданными агента.

---

### Шаг 2: Деплой Telegram бота

```bash
cd examples/telegram-bot-agent
```

#### 2.1. Создание KV namespace в production

```bash
# Создать production KV namespace
wrangler kv:namespace create SESSIONS

# Результат будет содержать id, например:
# { binding = "SESSIONS", id = "abc123..." }
```

**Обновите `wrangler.jsonc`:**
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "abc123..."  // ← Вставьте id из команды выше
    }
  ]
}
```

#### 2.2. Настройка переменных окружения

**Обновите `wrangler.jsonc`:**
```jsonc
{
  "vars": {
    "AGENT_URL": "https://simple-prompt-agent.workers.dev"  // ← URL вашего агента
  }
}
```

#### 2.3. Установка секретов

```bash
# Установить Telegram Bot Token
wrangler secret put TELEGRAM_BOT_TOKEN
# Введите значение: 8043373726:AAGMn9IGGO_1XSQylpOorBiQNK-KZWF_xyY

# Опционально: Webhook secret для безопасности
wrangler secret put TELEGRAM_WEBHOOK_SECRET
# Введите случайную строку (например, сгенерируйте: openssl rand -hex 32)
```

#### 2.4. Деплой бота

```bash
pnpm deploy
# или
wrangler deploy
```

**Результат:**
```
✨ Deployed to https://telegram-bot-agent.workers.dev
```

---

### Шаг 3: Настройка Telegram Webhook

После деплоя нужно настроить webhook в Telegram, чтобы он отправлял обновления на ваш worker.

#### 3.1. Получить webhook URL

Ваш webhook URL будет:
```
https://telegram-bot-agent.workers.dev/webhook
```

#### 3.2. Установить webhook

```bash
# Замените YOUR_BOT_TOKEN и YOUR_WEBHOOK_SECRET
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://telegram-bot-agent.workers.dev/webhook&secret_token=YOUR_WEBHOOK_SECRET"
```

**Или через браузер:**
```
https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://telegram-bot-agent.workers.dev/webhook&secret_token=YOUR_WEBHOOK_SECRET
```

#### 3.3. Проверить webhook

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Должен показать ваш webhook URL в поле `url`.

---

## ✅ Проверка работы

### 1. Проверить агента

```bash
curl https://simple-prompt-agent.workers.dev/
```

### 2. Проверить бота

```bash
curl https://telegram-bot-agent.workers.dev/health
```

Должен вернуть:
```json
{"status":"ok","service":"telegram-bot-agent"}
```

### 3. Протестировать в Telegram

1. Откройте Telegram
2. Найдите вашего бота
3. Отправьте `/start`
4. Отправьте сообщение
5. Должен прийти ответ от AI!

---

## 🔧 Конфигурация для production

### `wrangler.jsonc` для агента

```jsonc
{
  "name": "simple-prompt-agent",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },
  "durable_objects": {
    "bindings": [
      {
        "name": "AGENT",
        "class_name": "SimplePromptAgent"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["SimplePromptAgent"]
    }
  ],
  "ai": {
    "binding": "AI"
  },
  "vars": {
    "AI_PROVIDER": "anthropic",  // или другой провайдер
    "USE_MOCK_AI": "false"
  }
}
```

### `wrangler.jsonc` для бота

```jsonc
{
  "name": "telegram-bot-agent",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-22",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true
  },
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "abc123..."  // ← Production KV namespace ID
    }
  ],
  "vars": {
    "AGENT_URL": "https://simple-prompt-agent.workers.dev"
  }
}
```

---

## 🔐 Секреты (Secrets)

Секреты НЕ хранятся в `wrangler.jsonc` или `.dev.vars`. Они настраиваются отдельно:

```bash
# Установить секрет
wrangler secret put SECRET_NAME

# Просмотреть список секретов (имена только)
wrangler secret list

# Удалить секрет
wrangler secret delete SECRET_NAME
```

**Секреты для агента:**
- `ANTHROPIC_API_KEY` (или `OPEN_AI_API_KEY`, `DEEPSEEK_API_KEY`, и т.д.)
- `AI_PROVIDER`

**Секреты для бота:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (опционально)

---

## 🔄 Обновление деплоя

После изменений в коде:

```bash
# В папке агента
cd examples/simple-prompt-agent
pnpm deploy

# В папке бота
cd examples/telegram-bot-agent
pnpm deploy
```

Изменения применяются автоматически, без downtime!

---

## 🐛 Troubleshooting

### Бот не отвечает

1. **Проверьте webhook:**
   ```bash
   curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
   ```

2. **Проверьте логи:**
   ```bash
   wrangler tail telegram-bot-agent
   ```

3. **Проверьте агента:**
   ```bash
   curl https://simple-prompt-agent.workers.dev/
   ```

### Ошибка "KV namespace not found"

Убедитесь, что:
- KV namespace создан в production
- `id` правильно указан в `wrangler.jsonc`
- Вы деплоите в правильный аккаунт

### Ошибка "Agent URL not found"

Проверьте:
- Агент задеплоен и доступен
- `AGENT_URL` в `wrangler.jsonc` указывает на правильный URL
- URL начинается с `https://`

---

## 📊 Мониторинг

### Просмотр логов в реальном времени

```bash
# Логи агента
wrangler tail simple-prompt-agent

# Логи бота
wrangler tail telegram-bot-agent
```

### Cloudflare Dashboard

1. Откройте [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Workers & Pages → ваш worker
3. Logs → просмотр логов
4. Metrics → метрики использования

---

## 💰 Стоимость

**Cloudflare Workers (бесплатный план):**
- ✅ 100,000 запросов/день
- ✅ 10ms CPU time на запрос
- ✅ Durable Objects (бесплатно)
- ✅ 1 GB KV storage
- ✅ Workers AI (платно по использованию)

**Для Telegram бота:**
- ~1000 сообщений/день = бесплатно
- ~10,000 сообщений/день = бесплатно
- ~100,000 сообщений/день = бесплатно

---

## 🎯 Итого

**Что деплоится:**
1. ✅ Simple Prompt Agent → `https://simple-prompt-agent.workers.dev`
2. ✅ Telegram Bot Agent → `https://telegram-bot-agent.workers.dev`

**Что настраивается:**
1. ✅ Секреты (API ключи, токены)
2. ✅ KV namespace
3. ✅ Telegram webhook

**Результат:**
- ✅ Бот работает 24/7
- ✅ Автоматическое масштабирование
- ✅ Низкая задержка (edge-серверы)
- ✅ Бесплатно для большинства случаев

---

**Готово к деплою!** 🚀
