# Использование Cloudflare Tunnel вместо ngrok

## Преимущества

- ✅ Не требует регистрации
- ✅ Работает сразу после установки
- ✅ Бесплатно
- ✅ HTTPS из коробки

## Установка

```bash
brew install cloudflare/cloudflare/cloudflared
```

## Использование

### Шаг 1: Запустите tunnel

```bash
cloudflared tunnel --url http://localhost:8789
```

**Вы увидите что-то вроде:**
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take a minute to be reachable):  |
|  https://abc123-def456.trycloudflare.com                                                  |
+--------------------------------------------------------------------------------------------+
```

### Шаг 2: Скопируйте HTTPS URL

Скопируйте URL (например: `https://abc123-def456.trycloudflare.com`)

### Шаг 3: Установите webhook

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://abc123-def456.trycloudflare.com/webhook"
```

**Важно:** Замените URL на ваш реальный URL от cloudflared!

### Шаг 4: Проверьте webhook

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

## Полная команда для запуска

```bash
# Терминал 3
cloudflared tunnel --url http://localhost:8789
```

Затем скопируйте URL и установите webhook как показано выше.

## Готово!

Теперь можно тестировать бота в Telegram!
