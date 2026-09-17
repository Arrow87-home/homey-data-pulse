import { MonitorConfig } from './model';

export interface EvidenceSample {
  lastSeenAt?: unknown;
  capabilities?: Record<string, { value?: unknown }>;
}
export interface DeliveryDetector {
  read(
    config: MonitorConfig,
    sample: EvidenceSample,
    observedAt?: number,
  ): number | null;
}
export function parseTimestamp(
  value: unknown,
  encoding: 'iso' | 'epoch-seconds' | 'epoch-ms',
): number | null {
  let time = NaN;
  if (
    encoding === 'iso' &&
    typeof value === 'string' &&
    /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)
  )
    time = Date.parse(value);
  if (encoding !== 'iso' && typeof value === 'number')
    time = value * (encoding === 'epoch-seconds' ? 1000 : 1);
  return Number.isFinite(time) && time >= 0 ? time : null;
}
export class TimestampCapabilityStrategy implements DeliveryDetector {
  read(
    config: MonitorConfig,
    sample: EvidenceSample,
    observedAt = Date.now(),
  ): number | null {
    if (config.strategy.kind !== 'timestamp-capability') return null;
    const { encoding, capabilities } = config.strategy;
    const times = capabilities
      .map((id) => parseTimestamp(sample.capabilities?.[id]?.value, encoding))
      .filter((t): t is number => t !== null && t <= observedAt);
    return times.length ? Math.max(...times) : null;
  }
}
export class DeviceActivityStrategy implements DeliveryDetector {
  read(config: MonitorConfig, sample: EvidenceSample): number | null {
    if (config.strategy.kind !== 'device-last-seen') return null;
    const value =
      sample.lastSeenAt instanceof Date &&
      Number.isFinite(sample.lastSeenAt.getTime())
        ? sample.lastSeenAt.toISOString()
        : sample.lastSeenAt;
    return parseTimestamp(value, 'iso');
  }
}
export const detectors: DeliveryDetector[] = [
  new TimestampCapabilityStrategy(),
  new DeviceActivityStrategy(),
];

/** Future transport port, deliberately has no configured implementation in 0.1. */
export interface ExternalHeartbeatSink {
  publish(heartbeat: {
    schemaVersion: 1;
    instanceId: string;
    bootId: string;
    sequence: number;
    sentAt: number;
    observerHealthy: boolean;
  }): Promise<void>;
}
