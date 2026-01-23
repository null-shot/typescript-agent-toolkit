# Environment Variables

## Локальная разработка (.dev.vars)

Для локальной разработки используйте файл `.dev.vars`:

```env
TELEGRAM_BOT_TOKEN=ваш_токен_здесь
AGENT_URL=http://localhost:8787
TELEGRAM_WEBHOOK_SECRET=опциональный_секрет
```

**Как это работает:**
- Wrangler автоматически читает `.dev.vars` при запуске `wrangler dev`
- Переменные доступны через `env.TELEGRAM_BOT_TOKEN` в коде
- Файл `.dev.vars` уже в `.gitignore`, токен не попадет в git

## Production (Cloudflare Workers)

Для production используйте Cloudflare Secrets:

```bash
# Установить секрет
wrangler secret put TELEGRAM_BOT_TOKEN
# Введите токен когда попросит
```

**Как это работает:**
- Secrets хранятся в Cloudflare и шифруются
- Доступны через `env.TELEGRAM_BOT_TOKEN` в коде
- Безопаснее чем переменные окружения

## Переменные окружения

### TELEGRAM_BOT_TOKEN (обязательно)
- **Описание**: Токен вашего Telegram бота от @BotFather
- **Формат**: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
- **Где получить**: [@BotFather](https://t.me/BotFather) → `/newbot`
- **Локально**: `.dev.vars`
- **Production**: `wrangler secret put TELEGRAM_BOT_TOKEN`

### AGENT_URL (обязательно)
- **Описание**: URL агента для пересылки сообщений
- **Локально**: `http://localhost:8787`
- **Production**: `https://your-agent.workers.dev`
- **Можно указать**: В `.dev.vars` или `wrangler.jsonc` vars

### TELEGRAM_WEBHOOK_SECRET (опционально)
- **Описание**: Секрет для валидации webhook запросов
- **Рекомендуется**: Использовать в production для безопасности
- **Локально**: Можно не указывать
- **Production**: `wrangler secret put TELEGRAM_WEBHOOK_SECRET`

## Проверка переменных

### Локально
```bash
# Проверить что .dev.vars читается
cd examples/telegram-bot-agent
wrangler dev --local
# В логах не должно быть ошибок о отсутствии токена
```

### Production
```bash
# Проверить установленные secrets
wrangler secret list
```

## Безопасность

⚠️ **Важно:**
1. **Никогда не коммитьте** `.dev.vars` в git (уже в `.gitignore`)
2. **Не публикуйте** токен в публичных местах
3. **Используйте secrets** для production
4. **Регулярно ротируйте** токены если скомпрометированы

## Troubleshooting

### Ошибка: "TELEGRAM_BOT_TOKEN is not defined"
- Проверьте что `.dev.vars` существует
- Проверьте что токен указан правильно
- Перезапустите `wrangler dev`

### Ошибка: "Invalid token"
- Проверьте что токен скопирован полностью
- Убедитесь что нет лишних пробелов
- Попробуйте получить новый токен через @BotFather

### Production: Secret не работает
- Убедитесь что используете `wrangler secret put`, а не `vars`
- Проверьте что secret установлен: `wrangler secret list`
- Перезапустите worker после установки secret
