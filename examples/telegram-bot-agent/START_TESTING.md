# 🚀 Начинаем тестирование!

## ✅ Все готово к запуску!

- ✅ KV namespace создан и настроен
- ✅ Токен Telegram настроен
- ✅ Код готов
- ✅ Конфигурация обновлена

## 📋 Порядок запуска

### Шаг 1: Запустить агента (Терминал 1)

```bash
cd /Users/artem/projects/cletezt2/examples/simple-prompt-agent
pnpm dev
```

**Что должно произойти:**
- Агент запускается на порту 8787
- В логах видно информацию о провайдере AI
- Можно открыть `http://localhost:8787/` - должен вернуть JSON

**Проверка:**
```bash
# В другом терминале проверьте:
curl http://localhost:8787/
```

Должен вернуть JSON с метаданными агента.

### Шаг 2: Запустить Telegram бота (Терминал 2)

```bash
cd /Users/artem/projects/cletezt2/examples/telegram-bot-agent
pnpm dev
```

**Что должно произойти:**
- Бот запускается на порту 8789
- В логах: "Setting up permissionless agent session router"
- Можно открыть `http://localhost:8789/health` - должен вернуть `{"status":"ok"}`

**Проверка:**
```bash
# В другом терминале проверьте:
curl http://localhost:8789/health
```

Должен вернуть: `{"status":"ok","service":"telegram-bot-agent"}`

### Шаг 3: Запустить бота в Polling режиме (БЕЗ webhook!)

**Вариант А: Polling режим (рекомендуется для локального теста)**

```bash
cd examples/telegram-bot-agent
pnpm dev:polling
```

**Вот и всё!** Никаких ngrok, никаких webhook. Просто запустили и работает!

**Вариант Б: Webhook режим (для production)**

Если хотите использовать webhook (нужен ngrok):

**Установите ngrok** (если еще не установлен):
```bash
brew install ngrok
# или скачайте с https://ngrok.com/download
```

**Запустите ngrok:**
```bash
ngrok http 8789
```

**Скопируйте HTTPS URL** из вывода ngrok (например: `https://abc123.ngrok-free.app`)

**Установите webhook:**
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://ВАШ_NGROK_URL.ngrok-free.app/webhook"
```

**Проверьте webhook:**
```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

Должен показать ваш ngrok URL в поле `url`.

**Рекомендация:** Для локального тестирования используйте **Вариант А (Polling)** - проще и не требует ngrok!

### Шаг 4: Тестируйте в Telegram! 🎉

1. Откройте Telegram на телефоне или в приложении
2. Найдите вашего бота (username который вы указали при создании)
3. Отправьте команду `/start`
4. Бот должен ответить приветствием
5. Отправьте любое сообщение (например: "Привет, как дела?")
6. Должен получить ответ от AI агента!

## 🔍 Мониторинг логов

### Терминал 1 (Агент) - что смотреть:
- ✅ Запросы от бота: `POST /agent/chat/:sessionId`
- ✅ Обработка сообщений
- ✅ Ответы от AI модели
- ❌ Ошибки (если есть)

### Терминал 2 (Бот) - что смотреть:
- ✅ Webhook запросы: `POST /webhook`
- ✅ Запросы к агенту
- ✅ Отправка сообщений в Telegram
- ❌ Ошибки (если есть)

### Терминал 3 (ngrok) - что смотреть:
- ✅ HTTP запросы от Telegram
- ✅ Статус 200 OK
- ❌ Ошибки (если есть)

## ❌ Troubleshooting

### Бот не отвечает в Telegram

1. **Проверьте webhook:**
   ```bash
   curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
   ```
   Должен показать ваш ngrok URL

2. **Проверьте что оба сервиса запущены:**
   ```bash
   curl http://localhost:8787/ && echo "✅ Agent OK"
   curl http://localhost:8789/health && echo "✅ Bot OK"
   ```

3. **Проверьте логи** в терминалах на ошибки

### Ошибка "KV namespace not found"

Убедитесь что в `wrangler.jsonc` правильный `preview_id`:
```jsonc
"preview_id": "<YOUR_KV_PREVIEW_ID>"
```

### Ошибка подключения к агенту

1. Убедитесь что агент запущен: `curl http://localhost:8787/`
2. Проверьте `AGENT_URL` в `.dev.vars`: должно быть `http://localhost:8787`
3. Проверьте логи агента

### Агент не отвечает

1. Проверьте AI ключи в `simple-prompt-agent/.dev.vars`
2. Проверьте `AI_PROVIDER` (должен быть `anthropic` для вашего случая)
3. Проверьте логи агента на ошибки

## ✅ Готово!

Запустите все 3 терминала и начинайте тестирование! 🚀

Если что-то не работает - проверьте логи и сообщите об ошибках.
