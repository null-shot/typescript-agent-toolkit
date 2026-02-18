# Настройка Webhook - Пошаговая инструкция

## ✅ Что НЕ нужно менять:

1. **Порт 8789** - правильный, это порт на котором запускается бот ✅
2. **Токен в команде** - это ваш реальный токен из `.dev.vars` ✅
3. **Путь `/webhook`** - правильный endpoint ✅

## 🔄 Что нужно заменить:

**Только URL ngrok!** Замените `ВАШ_URL` на реальный URL который даст ngrok.

## 📋 Пошаговая инструкция:

### Шаг 1: Запустите ngrok

```bash
ngrok http 8789
```

**Вы увидите что-то вроде:**
```
Forwarding  https://abc123-def456.ngrok-free.app -> http://localhost:8789
```

### Шаг 2: Скопируйте HTTPS URL

Скопируйте URL из строки `Forwarding` (например: `https://abc123-def456.ngrok-free.app`)

### Шаг 3: Установите webhook

**Замените `ВАШ_URL` на скопированный URL:**

```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://abc123-def456.ngrok-free.app/webhook"
```

**Пример с реальным URL:**
Если ngrok дал вам `https://abc123-def456.ngrok-free.app`, то команда будет:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=https://abc123-def456.ngrok-free.app/webhook"
```

### Шаг 4: Проверьте webhook

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/getWebhookInfo"
```

**Ожидаемый ответ:**
```json
{
  "ok": true,
  "result": {
    "url": "https://abc123-def456.ngrok-free.app/webhook",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## ⚠️ Важно:

1. **ngrok должен быть запущен** пока вы тестируете
2. **URL меняется** при каждом перезапуске ngrok (если используете бесплатную версию)
3. **HTTPS обязателен** - Telegram требует HTTPS для webhook

## 🔄 Если перезапустили ngrok:

Если вы перезапустили ngrok и получили новый URL, нужно **повторно установить webhook** с новым URL.

## ✅ Готово!

После установки webhook можете тестировать бота в Telegram!
