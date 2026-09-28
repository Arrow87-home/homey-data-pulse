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
  if (encoding !== 'iso' && typeof value === 'number') {
    time = value * (encoding === 'epoch-seconds' ? 1000 : 1);
    // Delivery epochs must be between 2000-01-01 and 2100-01-01 (exclusive).
    // A measurement such as 21.4, 400 or 1234 is not a delivery timestamp.
    if (time < 946684800000 || time >= 4102444800000) return null;
  }
  return Number.isFinite(time) && time >= 0 ? time : null;
}

/** Strict capability-value parsing; leaves native activity/manual ISO handling intact. */
export function parseCapabilityTimestamp(
  value: unknown,
  encoding: 'iso' | 'epoch-seconds' | 'epoch-ms',
): number | null {
  if (encoding === 'iso') {
    if (typeof value !== 'string') return null;
    const parts =
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
        value,
      );
    if (!parts) return null;
    const [
      ,
      year,
      month,
      day,
      hour,
      minute,
      second,
      ,
      offsetHour,
      offsetMinute,
    ] = parts;
    const days = new Date(
      Date.UTC(Number(year), Number(month), 0),
    ).getUTCDate();
    if (
      Number(month) < 1 ||
      Number(month) > 12 ||
      Number(day) < 1 ||
      Number(day) > days ||
      Number(hour) > 23 ||
      Number(minute) > 59 ||
      Number(second) > 59 ||
      Number(offsetHour ?? 0) > 23 ||
      Number(offsetMinute ?? 0) > 59
    )
      return null;
  }
  return parseTimestamp(value, encoding);
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
      .map((id) =>
        parseCapabilityTimestamp(sample.capabilities?.[id]?.value, encoding),
      )
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
