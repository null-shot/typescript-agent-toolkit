#!/bin/bash

# Скрипт для создания KV namespace с правильной загрузкой nvm

# Загрузить nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Перейти в папку бота
cd "$(dirname "$0")"

# Создать KV namespace
echo "🚀 Создаю KV namespace для локальной разработки..."
pnpm wrangler kv:namespace create SESSIONS --preview

echo ""
echo "✅ Готово! Скопируйте preview_id из вывода выше"
echo "   и обновите wrangler.jsonc"
