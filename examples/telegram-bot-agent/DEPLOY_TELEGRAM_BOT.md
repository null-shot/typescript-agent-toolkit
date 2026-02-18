# Деплой Telegram бота - Пошаговая инструкция

## Важно: .dev.vars НЕ используется в production!

**`.dev.vars`** - это файл **только для локальной разработки** (`wrangler dev`).

**Для production** нужно использовать **Cloudflare Secrets** через `wrangler secret put`.

---

## Пошаговый деплой

### Шаг 1: Создать Production KV Namespace

```bash
cd examples/telegram-bot-agent
pnpm exec wrangler kv:namespace create SESSIONS
```

**Результат будет содержать `id`, например:**
```
🌀  Creating namespace with title "telegram-bot-agent-SESSIONS"
✨  Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SESSIONS", id = "abc123def456..." }
```

**Скопируйте `id`!**

### Шаг 2: Обновить wrangler.jsonc

Добавьте production KV namespace `id`:

```jsonc
{
  "kv_namespaces": [
    {
      "binding": "SESSIONS",
      "id": "abc123def456..."  // ← Вставьте id из шага 1
    }
  ]
}
```

**Также обновите AGENT_URL:**
```jsonc
{
  "vars": {
    "AGENT_URL": "https://your-agent.your-subdomain.workers.dev"  // ← URL вашего агента
  }
}
```

### Шаг 3: Установить секреты (TELEGRAM_BOT_TOKEN)

**Это ключевой момент!** Токен НЕ берется из `.dev.vars` в production.

```bash
pnpm exec wrangler secret put TELEGRAM_BOT_TOKEN
```

**Когда попросит, введите токен от @BotFather.**

### Шаг 4: Опционально - Webhook Secret

Для безопасности можно установить webhook secret:

```bash
pnpm exec wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

**Введите случайную строку** (можно сгенерировать: `openssl rand -hex 32`)

### Шаг 5: Деплой

```bash
pnpm exec wrangler deploy
```

**Результат:**
```
✨ Deployed to https://telegram-bot-agent.your-subdomain.workers.dev
```

### Шаг 6: Настроить Telegram Webhook

После деплоя нужно настроить webhook в Telegram:

```bash
# Замените YOUR_BOT_TOKEN и YOUR_WORKER_URL на ваши значения
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_WORKER_URL/webhook"
```

**Или если установили webhook secret:**
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://YOUR_WORKER_URL/webhook&secret_token=YOUR_WEBHOOK_SECRET"
```

### Шаг 7: Проверка

```bash
# Проверить бота
curl https://YOUR_WORKER_URL/health

# Проверить webhook
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

---

## Где хранятся секреты?

### Локальная разработка:
- **Файл:** `.dev.vars`
- **Читается:** автоматически при `wrangler dev`
- **Использование:** только локально

### Production:
- **Хранилище:** Cloudflare Secrets (зашифровано)
- **Установка:** `wrangler secret put TELEGRAM_BOT_TOKEN`
- **Использование:** доступно через `env.TELEGRAM_BOT_TOKEN` в коде

---

## Чеклист деплоя

- [ ] Создан production KV namespace
- [ ] Обновлен `wrangler.jsonc` с production KV `id`
- [ ] Обновлен `AGENT_URL` на production URL
- [ ] Установлен секрет `TELEGRAM_BOT_TOKEN`
- [ ] (Опционально) Установлен секрет `TELEGRAM_WEBHOOK_SECRET`
- [ ] Выполнен деплой (`wrangler deploy`)
- [ ] Настроен Telegram webhook
- [ ] Проверена работа бота

---

## Итого

**`.dev.vars` НЕ используется в production!**

Для production:
1. Используйте `wrangler secret put TELEGRAM_BOT_TOKEN`
2. Введите токен когда попросит
3. Токен будет храниться безопасно в Cloudflare
