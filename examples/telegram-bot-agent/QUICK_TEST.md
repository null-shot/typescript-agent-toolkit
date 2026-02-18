# Быстрый тест - пошаговая инструкция

## ✅ Что уже готово:
- ✅ `.dev.vars` создан с токеном
- ✅ Код готов
- ✅ Конфигурация настроена

## 🚀 Шаги для тестирования:

### 1. Установите зависимости (если еще не установлены)

```bash
cd /Users/artem/projects/cletezt2
pnpm install
```

### 2. Создайте KV namespace для локальной разработки

```bash
cd examples/telegram-bot-agent
pnpm wrangler kv:namespace create SESSIONS --preview
```

Скопируйте полученный `preview_id` и обновите `wrangler.jsonc`:

```jsonc
"kv_namespaces": [
  {
    "binding": "SESSIONS",
    "preview_id": "ВАШ_PREVIEW_ID_ЗДЕСЬ"
  }
]
```

### 3. Запустите агента (Терминал 1)

```bash
cd examples/simple-prompt-agent
pnpm dev
```

Должен запуститься на `http://localhost:8787`

**Проверка:** Откройте `http://localhost:8787/` - должно показать JSON с метаданными.

### 4. Запустите Telegram бота (Терминал 2)

```bash
cd examples/telegram-bot-agent
pnpm dev
```

Должен запуститься на `http://localhost:8789`

**Проверка:** Откройте `http://localhost:8789/health` - должно вернуть `{"status":"ok"}`

### 5. Настройте webhook через ngrok

**Установите ngrok** (если еще не установлен):
```bash
brew install ngrok
# или скачайте с https://ngrok.com/
```

**Запустите ngrok** (Терминал 3):
```bash
ngrok http 8789
```

Скопируйте HTTPS URL (например: `https://abc123.ngrok.io`)

**Установите webhook:**
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://ВАШ_NGROK_URL.ngrok.io/webhook"
```

**Проверьте webhook:**
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

### 6. Протестируйте в Telegram! 🎉

1. Откройте Telegram
2. Найдите вашего бота
3. Отправьте `/start`
4. Отправьте любое сообщение
5. Получите ответ от агента!

## 🔍 Проверка работы

### Логи агента (Терминал 1)
Вы должны видеть:
- Запросы от бота
- Обработку сообщений
- Ответы от AI

### Логи бота (Терминал 2)
Вы должны видеть:
- Webhook запросы от Telegram
- Запросы к агенту
- Отправку ответов

## ❌ Troubleshooting

### Ошибка "KV namespace not found"
Создайте preview namespace (шаг 2 выше)

### Бот не отвечает
1. Проверьте что оба сервиса запущены
2. Проверьте webhook: `curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"`
3. Проверьте логи в терминалах

### Ошибка подключения к агенту
1. Убедитесь что агент запущен: `curl http://localhost:8787/`
2. Проверьте `AGENT_URL` в `.dev.vars`

## 🎯 Готово!

Теперь бот должен работать локально! Отправьте сообщение в Telegram и получите ответ от AI агента.
