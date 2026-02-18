# Стратегия тестирования Telegram-агентов и Single Worker

## Обзор архитектуры

### 1. Telegram Bot Agent (standalone)

Отдельный пример `telegram-bot-agent` с полным функционалом:

| Категория         | Команды/Функции                                  | Описание                            |
| ----------------- | ------------------------------------------------ | ----------------------------------- |
| **Agent**         | `/start`, `/help`, `/agent`, `/status`, `/clear` | Чат с AI, смена агента              |
| **Channel**       | `/addchannel`, `/channels`, `/post`, `/schedule` | Постинг в каналы                    |
| **Schedule**      | Cron, отложенные посты                           | Публикация по расписанию            |
| **Moderation**    | `/moderate`, автоматические действия             | Спам, scam, hate speech             |
| **Proactive**     | Автоответы на вопросы/упоминания                 | Реакция в группах без явного вызова |
| **Setup**         | `/setup`                                         | Роль бота, промпты                  |
| **Task (Kanban)** | Callbacks, inline-кнопки                         | Создание, одобрение, отмена задач   |
| **Owner**         | `/mychats`, `/scan`, `/pin`                      | Список чатов, PIN для Dashboard     |

### 2. Single Worker (интегрированный)

Один воркер объединяет:

- Playground UI (чат + вкладка Manager Dashboard)
- SimplePromptAgent, DependentAgent (Durable Objects)
- MCP серверы (todo, expense, env-variable, secret)
- Telegram Bot (импортирует handlers из `telegram-bot-agent`)
- Dashboard API (настройки через фронтенд)

---

## Текущее покрытие тестами

### ✅ Уже есть тесты

#### telegram-bot-agent

- `spam-detector.test.ts` — модерация (spam, scam, hate, links)
- `cron-matcher.test.ts` — парсинг cron, `cronMatchesNow`, `shouldRunAgain`
- `post-styles.test.ts` — генерация постов (news, promo, русский)
- `proactive.test.ts` — вопросы (`isQuestion`), ключевые слова (`matchesKeywords`)

#### single-worker

- `todo-mcp.test.ts`, `expense-mcp.test.ts`, `env-variable-mcp.test.ts`, `secret-mcp.test.ts` — только MCP серверы (34 теста)

### ❌ Чего нет

1. **Telegram Bot handlers** — нет интеграционных тестов
2. **Dashboard API** — `/api/dashboard/*` не тестируются
3. **Webhook** — `/telegram/webhook` не тестируется
4. **/telegram/test** — endpoint для эмуляции DM/group mode не тестируется
5. **Фронтенд** — настройка через Dashboard UI не покрыта

---

## Стратегия тестирования

### Уровень 1: Unit-тесты (расширить)

| Модуль                  | Файл                         | Что добавить                                         |
| ----------------------- | ---------------------------- | ---------------------------------------------------- |
| `agent-handler.ts`      | `agent-handler.test.ts`      | `parseAgentsEnv()`, `getAvailableAgents()`           |
| `channel-handler.ts`    | `channel-handler.test.ts`    | Парсинг аргументов команды                           |
| `schedule-handler.ts`   | `schedule-handler.test.ts`   | Парсинг cron, времени                                |
| `moderation-handler.ts` | `moderation-handler.test.ts` | Применение настроек                                  |
| `session.ts`            | `session.test.ts`            | `getOrCreateSessionData()`                           |
| `message-history.ts`    | `message-history.test.ts`    | `historyToModelMessages()`, `getAgentSystemPrompt()` |

### Уровень 2: Интеграционные тесты (API)

Использовать `@cloudflare/vitest-pool-workers` для тестирования воркера:

```typescript
// single-worker/test/dashboard-api.test.ts
import { env, createExecutionContext } from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";

// Мок для SESSIONS KV
const mockSessions = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  list: vi.fn(),
};

describe("Dashboard API", () => {
  it("GET /api/dashboard returns 404 when TELEGRAM_BOT_TOKEN not set", async () => {
    const req = new Request("http://localhost/api/dashboard", {
      headers: { "X-Dashboard-Pin": "123456" },
    });
    const res = await env.fetch(req);
    expect(res.status).toBe(404);
  });

  it("GET /api/dashboard requires X-Dashboard-Pin", async () => {
    const req = new Request("http://localhost/api/dashboard");
    const res = await env.fetch(req);
    expect(res.status).toBe(401);
  });
});
```

**Проблема:** `single-worker` в `env` не инжектит реальный Hono app — тесты MCP используют `StubSSEClientTransport` и напрямую DO. Для Dashboard нужно вызывать `fetch` на worker.

**Решение:** В `vitest.config.ts` указать `main` как entry point, тогда `env` в Cloudflare Test будет выполнять worker.

### Уровень 3: Webhook simulation

Симуляция Telegram Update:

```typescript
// single-worker/test/telegram-webhook.test.ts
const mockTelegramUpdate = {
  update_id: 1,
  message: {
    message_id: 1,
    from: { id: 123456, first_name: "Test", username: "testuser" },
    chat: { id: 123456, type: "private" },
    text: "/start",
  },
};

const req = new Request("http://localhost/telegram/webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(mockTelegramUpdate),
});
// Для webhook нужен TELEGRAM_BOT_TOKEN — mock или skip
```

### Уровень 4: `/telegram/test` endpoint

Этот endpoint уже эмулирует DM и Group Mode без реального Telegram:

```typescript
// single-worker/test/telegram-test-endpoint.test.ts
it("POST /telegram/test — DM mode returns agent response", async () => {
  const req = new Request("http://localhost/telegram/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Hello" }],
      id: "test-session",
    }),
  });
  const res = await env.fetch(req);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toBeTruthy();
});
```

### Уровень 5: E2E тесты (Playwright / Browser MCP)

Для проверки настройки через фронтенд:

1. **Логин** — ввести PIN в форму
2. **Dashboard** — загрузка каналов, групп, scheduled posts
3. **Bot Settings** — изменение имени, описания, команд
4. **Chat Settings** — moderation, proactive, agent для чата
5. **Webhook** — отображение статуса, установка/удаление
6. **Tasks** — просмотр Kanban, создание задачи

---

## Рекомендуемый план тестов

### Приоритет 1 (быстро)

1. **Unit-тесты** для `agent-handler`, `session`, `message-history` в `telegram-bot-agent`
2. **API-тесты** в `single-worker` для `/api/auth/login`, `/api/auth/status`, `/api/dashboard` (с моком KV и без реального TELEGRAM_BOT_TOKEN, чтобы проверить 401/403/404)

### Приоритет 2 (средне)

3. **Dashboard API** — все GET/POST/PUT/DELETE с правильным PIN
4. **/telegram/test** — DM и Group Mode с моком `SESSIONS` и `AGENT_SERVICE`

### Приоритет 3 (долго)

5. **Webhook** — симуляция Telegram Update (требует mock Telegram API или `TELEGRAM_BOT_TOKEN` в dev)
6. **E2E** — сценарии в браузере (Playwright / MCP browser)

---

## Настройка через Dashboard (Single Worker)

### Endpoints

| Endpoint                                          | Метод           | Описание                                      |
| ------------------------------------------------- | --------------- | --------------------------------------------- |
| `/api/dashboard`                                  | GET             | Сводка: каналы, группы, scheduled, moderation |
| `/api/dashboard/bot-settings`                     | GET             | Имя, описание, команды бота                   |
| `/api/dashboard/bot-settings/name`                | POST            | Обновить имя                                  |
| `/api/dashboard/bot-settings/description`         | POST            | Описание                                      |
| `/api/dashboard/bot-settings/short-description`   | POST            | Short description                             |
| `/api/dashboard/bot-settings/commands`            | POST/DELETE     | Управление командами                          |
| `/api/dashboard/bot-settings/profile`             | POST            | Аватар, описание                              |
| `/api/dashboard/settings/:chatId`                 | GET             | Настройки чата (moderation, proactive, agent) |
| `/api/dashboard/settings/channel`                 | POST            | Добавить канал                                |
| `/api/dashboard/settings/moderation`              | POST            | Уровни модерации                              |
| `/api/dashboard/settings/proactive`               | POST            | Proactive mode                                |
| `/api/dashboard/settings/agent`                   | POST            | Агент для чата                                |
| `/api/dashboard/webhook`                          | GET/POST/DELETE | Webhook                                       |
| `/api/dashboard/scheduled/:postKey`               | DELETE          | Удалить отложенный пост                       |
| `/api/dashboard/tasks`                            | GET/POST        | Kanban                                        |
| `/api/dashboard/tasks/:taskId`                    | GET/POST/DELETE | Задача                                        |
| `/api/dashboard/tasks/:taskId/move`               | POST            | Перенос                                       |
| `/api/dashboard/setup`                            | GET/POST        | Initial setup                                 |
| `/api/dashboard/settings/:chatId/moderation-logs` | GET/DELETE      | Логи модерации                                |

Все требуют `X-Dashboard-Pin` (кроме `POST /api/dashboard/webhook` при bootstrap).

### Тестирование фронтенда

1. Убедиться, что PIN сгенерирован (`/start` в Telegram)
2. Открыть Playground → вкладка Manager Dashboard
3. Ввести PIN — должен загрузиться Dashboard
4. Проверить каждый раздел: Bot Settings, Channels, Moderation, Proactive, Webhook, Tasks

---

## Чеклист для прогона вручную

| #   | Компонент      | Шаг                  | Ожидание               |
| --- | -------------- | -------------------- | ---------------------- |
| 1   | Auth           | Логин без PIN        | 401                    |
| 2   | Auth           | Логин с неверным PIN | 403                    |
| 3   | Auth           | Логин с верным PIN   | 200                    |
| 4   | Dashboard      | GET без PIN          | 401                    |
| 5   | Dashboard      | GET с PIN            | 200, JSON              |
| 6   | Bot Settings   | POST name            | 200                    |
| 7   | Webhook        | GET status           | 200                    |
| 8   | Webhook        | POST auto            | 200                    |
| 9   | /telegram/test | DM "Hello"           | 200, текст ответа      |
| 10  | /telegram/test | Group mode           | moderation + proactive |
| 11  | Telegram       | /start               | PIN в ответе           |
| 12  | Telegram       | /agent               | Inline keyboard        |
| 13  | Telegram       | /channels            | Список каналов         |
| 14  | Telegram       | /moderate            | Настройки              |

---

## Выводы

- **Unit-тесты** для `telegram-bot-agent` уже есть (spam, cron, post-styles, proactive). Добавить: `agent-handler`, `session`, `message-history`, парсинг команд.
- **Dashboard API** — тестировать через `fetch` с `X-Dashboard-Pin`, используя KV mock.
- **/telegram/test** — единственный endpoint, который эмулирует полный pipeline без Telegram; даёт хорошее покрытие DM и Group Mode.
- **Webhook** — сложнее без реального бота; можно симулировать Update, но ответы будут уходить в Telegram API.
- **E2E** — Playwright для проверки UI Dashboard; можно использовать MCP browser для автоматизации.
