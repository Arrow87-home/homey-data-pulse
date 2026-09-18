import type { WatchdogEvent } from '../core/model';
import { flowTokens } from './tokens';

type FlowPort = {
  getTriggerCard(id: string): {
    trigger(tokens: ReturnType<typeof flowTokens>): Promise<unknown>;
  };
};

/** Both attempts are independent, including for the local test source. */
export async function dispatchFlows(
  flow: FlowPort,
  event: WatchdogEvent,
): Promise<void> {
  const tokens = flowTokens(event);
  const results = await Promise.allSettled([
    flow.getTriggerCard(event.type).trigger(tokens),
    flow
      .getTriggerCard(
        event.type.endsWith('_recovered')
          ? 'any_incident_recovered'
          : 'any_incident_started',
      )
      .trigger(tokens),
  ]);
  if (results.some((r) => r.status === 'rejected'))
    throw new Error('Flow dispatch failed');
}
