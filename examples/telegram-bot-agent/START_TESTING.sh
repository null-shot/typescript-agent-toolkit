#!/bin/bash

# Скрипт для быстрого запуска локального тестирования

echo "🚀 Запуск локального тестирования Telegram бота"
echo ""

# Проверка .dev.vars
if [ ! -f .dev.vars ]; then
    echo "❌ .dev.vars не найден!"
    echo "Создайте файл .dev.vars с TELEGRAM_BOT_TOKEN"
    exit 1
fi

echo "✅ .dev.vars найден"

# Проверка зависимостей
if [ ! -d "node_modules" ]; then
    echo "📦 Установка зависимостей..."
    pnpm install
fi

echo ""
echo "📋 Инструкции для тестирования:"
echo ""
echo "1. Откройте ТЕРМИНАЛ 1 и запустите агента:"
echo "   cd ../simple-prompt-agent"
echo "   pnpm dev"
echo ""
echo "2. Откройте ТЕРМИНАЛ 2 и запустите бота:"
echo "   cd examples/telegram-bot-agent"
echo "   pnpm dev"
echo ""
echo "3. Настройте webhook через ngrok:"
echo "   ngrok http 8789"
echo "   curl -X POST \"https://api.telegram.org/bot<TOKEN>/setWebhook?url=<ngrok_url>/webhook\""
echo ""
echo "4. Протестируйте в Telegram!"
echo ""
