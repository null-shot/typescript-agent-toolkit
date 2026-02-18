# 🚀 Запуск - ВСЕ ГОТОВО!

## ✅ Что уже сделано:
- ✅ KV namespace создан
- ✅ wrangler.jsonc обновлен
- ✅ Токен настроен
- ✅ Зависимости установлены

## 🎯 Запуск (3 терминала)

### Терминал 1: Запустить агента

```bash
cd /Users/artem/projects/cletezt2/examples/simple-prompt-agent
pnpm dev
```

**Ожидаемый результат:**
- Агент запускается на `http://localhost:8787`
- В логах видно: "Using Workers AI..." или информацию о провайдере

**Проверка:**
```bash
curl http://localhost:8787/
# Должен вернуть JSON с метаданными
```

### Терминал 2: Запустить Telegram бота

```bash
cd /Users/artem/projects/cletezt2/examples/telegram-bot-agent
pnpm dev
```

**Ожидаемый результат:**
- Бот запускается на `http://localhost:8789`
- В логах: "Setting up permissionless agent session router"

**Проверка:**
```bash
curl http://localhost:8789/health
# Должен вернуть: {"status":"ok","service":"telegram-bot-agent"}
```

### Терминал 3: Настроить webhook через ngrok

**Установите ngrok** (если еще не установлен):
```bash
brew install ngrok
# или скачайте с https://ngrok.com/
```

**Запустите ngrok:**
```bash
ngrok http 8789
```

**Скопируйте HTTPS URL** (например: `https://abc123.ngrok.io`)

**Установите webhook:**
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://ВАШ_NGROK_URL.ngrok.io/webhook"
```

**Проверьте webhook:**
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Должен показать ваш ngrok URL.

## 🎉 Тестирование в Telegram

1. Откройте Telegram
2. Найдите вашего бота
3. Отправьте `/start` - должен ответить приветствием
4. Отправьте сообщение (например: "Привет, как дела?")
5. Получите ответ от AI агента!

## 🔍 Что смотреть в логах

### Терминал 1 (Агент)
- Запросы: `POST /agent/chat/:sessionId`
- Обработка сообщений
- Ответы от AI

### Терминал 2 (Бот)
- Webhook запросы: `POST /webhook`
- Запросы к агенту
- Отправка в Telegram

### Терминал 3 (ngrok)
- HTTP запросы от Telegram
- Статус 200 OK

## ✅ Готово к запуску!

Запустите все 3 терминала и протестируйте! 🚀
