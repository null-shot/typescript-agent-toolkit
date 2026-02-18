/**
 * Dashboard Routes (re-export)
 *
 * Re-exports the shared dashboard module from telegram-bot-agent.
 * Single-worker-specific customizations (if any) can be added here.
 */

export {
  DASHBOARD_PIN_KEY,
  generatePin,
  hashPin,
  setupDashboardRoutes,
  type DashboardRoutesOptions,
} from "../../telegram-bot-agent/src/dashboard/setup-dashboard";
