# ⚡ Быстрый деплой

## 🚀 За 5 минут

### 1. Деплой агента

```bash
cd examples/simple-prompt-agent

# Установить секреты
wrangler secret put ANTHROPIC_API_KEY
# Введите: sk-ant-api03-...

wrangler secret put AI_PROVIDER
# Введите: anthropic

# Деплой
pnpm deploy
```

**Сохраните URL:** `https://simple-prompt-agent.workers.dev`

---

### 2. Деплой бота

```bash
cd examples/telegram-bot-agent

# Создать KV namespace
wrangler kv:namespace create SESSIONS
# Скопируйте id из вывода

# Обновить wrangler.jsonc:
# - Вставить production KV id
# - Изменить AGENT_URL на https://simple-prompt-agent.workers.dev

# Установить секреты
wrangler secret put TELEGRAM_BOT_TOKEN
# Введите: YOUR_BOT_TOKEN

# Деплой
pnpm deploy
```

**Сохраните URL:** `https://telegram-bot-agent.workers.dev`

---

### 3. Настроить Telegram webhook

```bash
# Замените YOUR_BOT_TOKEN и YOUR_WEBHOOK_SECRET
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://telegram-bot-agent.workers.dev/webhook&secret_token=YOUR_WEBHOOK_SECRET"
```

---

### 4. Проверить

```bash
# Проверить агента
curl https://simple-prompt-agent.workers.dev/

# Проверить бота
curl https://telegram-bot-agent.workers.dev/health

# Проверить webhook
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

---

**Готово!** Откройте Telegram и протестируйте бота! 🎉
