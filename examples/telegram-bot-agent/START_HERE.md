# 🚀 Начните отсюда!

## Шаг 1: Создайте KV Namespace

**Выполните в вашем терминале:**

```bash
cd /Users/artem/projects/cletezt2/examples/telegram-bot-agent
pnpm wrangler kv:namespace create SESSIONS --preview
```

**Скопируйте `preview_id` из вывода и обновите `wrangler.jsonc`**

## Шаг 2: Запустите агента (Терминал 1)

```bash
cd /Users/artem/projects/cletezt2/examples/simple-prompt-agent
pnpm dev
```

**Проверка:** Откройте `http://localhost:8787/` - должно показать JSON

## Шаг 3: Запустите бота (Терминал 2)

```bash
cd /Users/artem/projects/cletezt2/examples/telegram-bot-agent
pnpm dev
```

**Проверка:** Откройте `http://localhost:8789/health` - должно вернуть `{"status":"ok"}`

## Шаг 4: Настройте webhook (Терминал 3)

```bash
# Установите ngrok (если еще не установлен)
brew install ngrok

# Запустите ngrok
ngrok http 8789

# Скопируйте HTTPS URL (например: https://abc123.ngrok.io)
# Установите webhook:
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://ВАШ_URL.ngrok.io/webhook"
```

## Шаг 5: Тестируйте! 🎉

1. Откройте Telegram
2. Найдите вашего бота
3. Отправьте `/start`
4. Отправьте сообщение
5. Получите ответ от AI!

## ❓ Проблемы?

Смотрите:
- `LAUNCH_CHECKLIST.md` - детальный чеклист
- `TESTING_LOCAL.md` - troubleshooting
- `QUICK_TEST.md` - быстрая инструкция

---

**Готовы? Начните с Шага 1! 🚀**
