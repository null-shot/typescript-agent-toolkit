# Локальное тестирование Telegram бота

## Шаг 1: Установка зависимостей

```bash
# Из корня проекта
cd /Users/artem/projects/cletezt2
pnpm install

# Или из папки бота
cd examples/telegram-bot-agent
pnpm install
```

## Шаг 2: Настройка KV Namespace (для локальной разработки)

Для локальной разработки можно использовать preview KV namespace:

```bash
cd examples/telegram-bot-agent

# Создать preview KV namespace
wrangler kv:namespace create SESSIONS --preview

# Обновить wrangler.jsonc с полученным preview_id
```

Или можно временно использовать mock (для первого теста):

```jsonc
// wrangler.jsonc - временно для теста
"kv_namespaces": [
  {
    "binding": "SESSIONS",
    "preview_id": "test_preview_id"  // Wrangler создаст временный
  }
]
```

## Шаг 3: Запуск агента (в отдельном терминале)

```bash
cd examples/simple-prompt-agent
pnpm dev
```

Это запустит агента на `http://localhost:8787`

**Проверка:** Откройте `http://localhost:8787/` в браузере - должно вернуть JSON с метаданными агента.

## Шаг 4: Запуск Telegram бота

```bash
cd examples/telegram-bot-agent
pnpm dev
```

Бот запустится на `http://localhost:8789`

**Проверка:** Откройте `http://localhost:8789/health` - должно вернуть `{"status":"ok","service":"telegram-bot-agent"}`

## Шаг 5: Настройка Webhook (для локального тестирования)

### Вариант А: Использовать ngrok

1. Установите ngrok: https://ngrok.com/
2. Запустите ngrok:
   ```bash
   ngrok http 8789
   ```
3. Скопируйте HTTPS URL (например: `https://abc123.ngrok.io`)
4. Установите webhook:
   ```bash
   curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://abc123.ngrok.io/webhook"
   ```

### Вариант Б: Использовать Cloudflare Tunnel (альтернатива)

```bash
# Установите cloudflared
brew install cloudflared  # или другой пакетный менеджер

# Запустите tunnel
cloudflared tunnel --url http://localhost:8789
```

## Шаг 6: Тестирование

1. Откройте Telegram
2. Найдите вашего бота (username который вы указали при создании)
3. Отправьте `/start` - должен ответить приветствием
4. Отправьте любое сообщение - должно переслать агенту и вернуть ответ

## Проверка логов

### Логи агента
В терминале где запущен `simple-prompt-agent` вы увидите:
- Запросы к агенту
- Обработку сообщений
- Ответы от AI

### Логи бота
В терминале где запущен `telegram-bot-agent` вы увидите:
- Webhook запросы от Telegram
- Запросы к агенту
- Отправку сообщений в Telegram

## Troubleshooting

### Бот не отвечает

1. **Проверьте webhook:**
   ```bash
   curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
   ```
   Должен показать URL webhook

2. **Проверьте что бот запущен:**
   ```bash
   curl http://localhost:8789/health
   ```

3. **Проверьте логи:**
   - Смотрите вывод в терминале где запущен бот
   - Ищите ошибки

### Ошибка "KV namespace not found"

Для локального тестирования можно временно закомментировать использование KV или создать preview namespace:

```bash
wrangler kv:namespace create SESSIONS --preview
```

### Ошибка подключения к агенту

1. Убедитесь что агент запущен: `curl http://localhost:8787/`
2. Проверьте `AGENT_URL` в `.dev.vars`
3. Проверьте логи агента

### Webhook не работает

1. Убедитесь что используете HTTPS URL (ngrok/cloudflared)
2. Проверьте что порт 8789 доступен
3. Проверьте что webhook установлен правильно

## Быстрый тест без webhook

Можно протестировать напрямую через curl:

```bash
# Тест webhook endpoint
curl -X POST http://localhost:8789/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {"id": 123, "first_name": "Test"},
      "chat": {"id": 123},
      "text": "Hello"
    }
  }'
```

Это симулирует сообщение от Telegram.

## Готово!

После выполнения всех шагов бот должен работать локально. Отправьте сообщение в Telegram и получите ответ от агента!
