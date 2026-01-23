# Playground Worker

Простой веб-интерфейс для чата с AI агентами, развернутый как Cloudflare Worker.

## Особенности

- 🚀 Развернут как Cloudflare Worker
- 🔗 Service Binding для надежной коммуникации с агентом
- 🤖 **Multi-Agent Support** - выбор из нескольких агентов
- 💬 Простой и красивый чат интерфейс
- 📡 Streaming ответы от агента
- 🔄 Автоматическая проверка статуса соединения
- ➕ Добавление custom агентов через UI

## Быстрый старт

### 1. Установка зависимостей

```bash
cd examples/playground-worker
pnpm install
```

### 2. Локальная разработка

```bash
pnpm dev
```

Откройте `http://localhost:8790` в браузере.

### 3. Деплой

```bash
pnpm deploy
```

## Конфигурация

### Service Binding (рекомендуется)

В `wrangler.jsonc` настроен Service Binding к агенту:

```jsonc
"services": [
  {
    "binding": "AGENT_SERVICE",
    "service": "simple-prompt-agent"
  }
]
```

Это позволяет Workers общаться напрямую без HTTP.

### HTTP Fallback

Если Service Binding недоступен, используется HTTP:

```jsonc
"vars": {
  "AGENT_URL": "https://simple-prompt-agent.gribaart.workers.dev"
}
```

### Multiple Agents

Настройте список агентов через переменную `AGENTS`:

```jsonc
"vars": {
  "AGENT_URL": "https://simple-prompt-agent.gribaart.workers.dev",
  // Format: "name1|url1|description1,name2|url2|description2"
  "AGENTS": "Simple Agent|https://agent1.workers.dev|Default assistant,Queue Agent|https://agent2.workers.dev|Async processing"
}
```

Или через wrangler secret:

```bash
wrangler secret put AGENTS
# Paste: "Agent1|https://url1|Desc1,Agent2|https://url2|Desc2"
```

Пользователи также могут добавлять свои агенты через UI (кнопка "+ Add Agent").

## API Endpoints

- `GET /` - HTML интерфейс (агенты встроены в HTML из ENV)
- `GET /health` - Health check
- `GET /api/agent/health?agentUrl=...` - Проверка статуса агента
- `POST /api/agent/chat/:sessionId?agentUrl=...` - Отправка сообщений агенту

## Использование

1. Откройте playground в браузере
2. Дождитесь подключения (зеленый индикатор)
3. Введите сообщение и нажмите Send
4. Получите ответ от агента в реальном времени

## Архитектура

```
Browser → Playground Worker → Service Binding → AI Agent
```

Playground Worker проксирует запросы к агенту через Service Binding, что обеспечивает надежную коммуникацию без ошибок 1042.
