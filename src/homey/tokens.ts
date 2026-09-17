import { WatchdogEvent } from '../core/model';
export function flowTokens(
  event: WatchdogEvent,
): Record<string, string | number | boolean> {
  const m = event.monitor;
  return {
    source_app: event.sourceAppName,
    source_app_id: event.sourceAppId,
    device: m?.deviceName ?? '',
    device_id: m?.deviceId ?? '',
    zone: m?.zone ?? '',
    capability:
      m?.strategy.kind === 'timestamp-capability'
        ? m.strategy.capabilities.join(', ')
        : '',
    last_delivery:
      event.lastDeliveryAt === null
        ? ''
        : new Date(event.lastDeliveryAt).toISOString(),
    age_minutes:
      event.lastDeliveryAt === null
        ? -1
        : Math.max(0, (event.at - event.lastDeliveryAt) / 60_000),
    expected_interval: m ? m.expectedIntervalMs / 60_000 : 0,
    stale_timeout: m ? m.staleTimeoutMs / 60_000 : 0,
    affected_devices: event.affectedDevices.join(', '),
    affected_count: event.affectedCount,
    monitored_count: event.monitoredCount,
    recovered_count: event.recoveredCount,
    incident_duration: Math.max(0, (event.at - event.startedAt) / 60_000),
    stale_since: new Date(event.startedAt).toISOString(),
    status: event.type,
    incident_id: event.incidentId,
    evidence_kind: event.evidenceKind,
    has_delivery: event.lastDeliveryAt !== null,
  };
}
