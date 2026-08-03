import type { AnyMiddlewareArgs } from '@slack/bolt';
import type { AppMetrics } from './metrics/app.metrics';

export const createSlackMetricsMiddleware =
  (appMetrics: AppMetrics) =>
  async (args: AnyMiddlewareArgs & { next: () => Promise<void> }) => {
    const { next } = args;
    const b = (args as any).body;

    if (b?.type === 'block_actions') {
      for (const action of b.actions ?? []) {
        if (action.action_id)
          appMetrics.slackActionsTotal.inc({ action_id: action.action_id });
      }
    } else if (b?.type === 'view_submission' && b?.view?.callback_id) {
      appMetrics.slackActionsTotal.inc({ action_id: b.view.callback_id });
    }

    await next();
  };
