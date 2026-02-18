# ✅ Чеклист перед запуском

## Проверка готовности

### 1. Файлы и конфигурация ✅
- [x] `.dev.vars` создан с токеном
- [x] Код готов (src/index.ts и все модули)
- [x] `package.json` настроен
- [x] `wrangler.jsonc` настроен
- [x] `tsconfig.json` настроен

### 2. Зависимости
```bash
# Установите зависимости (если еще не установлены)
cd /Users/artem/projects/cletezt2
pnpm install
```

### 3. KV Namespace (обязательно!)
```bash
cd examples/telegram-bot-agent
pnpm wrangler kv:namespace create SESSIONS --preview
```

**После выполнения:**
- Скопируйте полученный `preview_id`
- Обновите `wrangler.jsonc`:
```jsonc
"kv_namespaces": [
  {
    "binding": "SESSIONS",
    "preview_id": "ВАШ_PREVIEW_ID_ЗДЕСЬ"
  }
]
```

### 4. Проверка агента
Убедитесь что `simple-prompt-agent` может запуститься:
```bash
cd examples/simple-prompt-agent
# Проверьте что .dev.vars есть и AI ключи настроены
cat .dev.vars | grep -q "ANTHROPIC_API_KEY" && echo "✅ AI key configured"
```

## 🚀 Порядок запуска

### Шаг 1: Запустить агента (Терминал 1)
```bash
cd examples/simple-prompt-agent
pnpm dev
```

**Ожидаемый результат:**
- Агент запускается на `http://localhost:8787`
- В логах нет ошибок
- Можно открыть `http://localhost:8787/` в браузере - должен вернуть JSON

**Проверка:**
```bash
curl http://localhost:8787/
# Должен вернуть JSON с метаданными агента
```

### Шаг 2: Запустить Telegram бота (Терминал 2)
```bash
cd examples/telegram-bot-agent
pnpm dev
```

**Ожидаемый результат:**
- Бот запускается на `http://localhost:8789`
- В логах нет ошибок о KV namespace
- Можно открыть `http://localhost:8789/health` - должен вернуть `{"status":"ok"}`

**Проверка:**
```bash
curl http://localhost:8789/health
# Должен вернуть: {"status":"ok","service":"telegram-bot-agent"}
```

### Шаг 3: Настроить webhook через ngrok (Терминал 3)

**Установите ngrok** (если еще не установлен):
```bash
# macOS
brew install ngrok

# Или скачайте с https://ngrok.com/
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

### Шаг 4: Тестирование в Telegram 🎉

1. Откройте Telegram
2. Найдите вашего бота (username который указали при создании)
3. Отправьте `/start` - должен ответить приветствием
4. Отправьте любое сообщение (например: "Привет, как дела?")
5. Должен получить ответ от AI агента!

## 🔍 Что проверять в логах

### Терминал 1 (Агент)
Должны видеть:
- `✅ Using Workers AI with model: ...` или информацию о провайдере
- Запросы от бота: `POST /agent/chat/:sessionId`
- Обработку сообщений
- Ответы от AI

### Терминал 2 (Бот)
Должны видеть:
- `Setting up permissionless agent session router`
- Webhook запросы: `POST /webhook`
- Запросы к агенту
- Отправку сообщений в Telegram

### Терминал 3 (ngrok)
Должны видеть:
- HTTP запросы от Telegram
- Статус 200 OK

## ❌ Troubleshooting

### Ошибка: "KV namespace not found"
**Решение:** Создайте preview namespace (шаг 3 выше)

### Ошибка: "TELEGRAM_BOT_TOKEN is not defined"
**Решение:** Проверьте `.dev.vars` файл, перезапустите `wrangler dev`

### Бот не отвечает в Telegram
**Проверьте:**
1. Webhook установлен: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
2. Оба сервиса запущены
3. ngrok работает
4. Логи в терминалах

### Ошибка подключения к агенту
**Проверьте:**
1. Агент запущен: `curl http://localhost:8787/`
2. `AGENT_URL` в `.dev.vars` правильный
3. Логи агента

### Агент не отвечает
**Проверьте:**
1. AI ключи в `simple-prompt-agent/.dev.vars`
2. `AI_PROVIDER` настроен правильно
3. Логи агента на ошибки

## ✅ Готово к запуску!

Если все шаги выполнены, можно начинать тестирование!

**Быстрая проверка:**
```bash
# 1. Проверка агента
curl http://localhost:8787/ && echo "✅ Agent OK"

# 2. Проверка бота
curl http://localhost:8789/health && echo "✅ Bot OK"

# 3. Проверка webhook
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo" && echo "✅ Webhook OK"
```

Все три команды должны вернуть успешный ответ!
