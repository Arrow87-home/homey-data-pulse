import { z } from 'zod';

const id = z.string().min(1).max(200);
const ms = z
  .number()
  .int()
  .positive()
  .max(365 * 86400_000);
export const strategySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('manual') }).strict(),
  z.object({ kind: z.literal('device-last-seen') }).strict(),
  z
    .object({
      kind: z.literal('timestamp-capability'),
      capabilities: z
        .array(id)
        .min(1)
        .max(16)
        .refine((a) => new Set(a).size === a.length),
      encoding: z.enum(['iso', 'epoch-seconds', 'epoch-ms']),
    })
    .strict(),
]);
export const monitorSchema = z
  .object({
    id,
    sourceAppId: id,
    sourceAppName: id,
    deviceId: id,
    deviceName: id,
    zone: z.string().max(200).default(''),
    strategy: strategySchema,
    sourceContract: z.string().min(10).max(2000),
    expectedIntervalMs: ms,
    staleTimeoutMs: ms,
    enabled: z.boolean(),
  })
  .strict()
  .refine((m) => m.staleTimeoutMs >= m.expectedIntervalMs, {
    message: 'staleTimeoutMs must be >= expectedIntervalMs',
  });
export const DEFAULTS = {
  schedulerMs: 10_000,
  snapshotMs: 60_000,
  inventoryMs: 300_000,
  correlationWindowMs: 60_000,
  minStaleDevices: 2,
  staleFraction: 0.8,
  recoveryFraction: 0.9,
  recoveryStabilityMs: 60_000,
} as const;
export const policySchema = z
  .object({
    correlationWindowMs: ms.default(DEFAULTS.correlationWindowMs),
    minStaleDevices: z
      .number()
      .int()
      .min(2)
      .max(500)
      .default(DEFAULTS.minStaleDevices),
    staleFraction: z.number().min(0.01).max(1).default(DEFAULTS.staleFraction),
    recoveryFraction: z
      .number()
      .min(0.5)
      .max(1)
      .default(DEFAULTS.recoveryFraction),
    recoveryStabilityMs: ms.default(DEFAULTS.recoveryStabilityMs),
  })
  .strict();
export const configSchema = z
  .object({
    version: z.literal(1),
    monitors: z.array(monitorSchema).max(500),
    policy: policySchema.default(() => policySchema.parse({})),
  })
  .strict()
  .superRefine((c, ctx) => {
    for (const field of ['id', 'deviceId'] as const) {
      if (new Set(c.monitors.map((m) => m[field])).size !== c.monitors.length)
        ctx.addIssue({ code: 'custom', message: `Duplicate ${field}` });
    }
  });
export type MonitorConfig = z.infer<typeof monitorSchema>;
export type WatchdogConfig = z.infer<typeof configSchema>;
export type Policy = z.infer<typeof policySchema>;
export interface Clock {
  now(): number;
}
export type MonitorState =
  | 'WARMING_UP'
  | 'HEALTHY'
  | 'SUSPECTED_STALE'
  | 'DEVICE_STALE'
  | 'RECOVERING'
  | 'DISABLED'
  | 'MISSING'
  | 'UNKNOWN';
const timestamp = z.number().finite().nonnegative().nullable();
export const runtimeSchema = z.object({
  state: z.enum([
    'WARMING_UP',
    'HEALTHY',
    'SUSPECTED_STALE',
    'DEVICE_STALE',
    'RECOVERING',
    'DISABLED',
    'MISSING',
    'UNKNOWN',
  ]),
  lastDeliveryAt: timestamp,
  observationStartedAt: z.number(),
  graceUntil: z.number(),
  staleSince: timestamp,
  healthySince: timestamp,
  recoveredAt: timestamp,
  present: z.boolean(),
  evidenceSinceResume: z.boolean(),
});
export type MonitorRuntime = z.infer<typeof runtimeSchema>;
export const deviceIncidentSchema = z.object({
  id: z.string().min(1).max(500),
  monitorId: id,
  startedAt: z.number().nonnegative(),
});
export const integrationIncidentSchema = z.object({
  id: z.string().min(1).max(500),
  sourceAppId: id,
  memberIds: z.array(id).min(1).max(500),
  affectedIds: z.array(id).max(500),
  startedAt: z.number(),
  recoveringSince: timestamp,
});
export type DeviceIncident = z.infer<typeof deviceIncidentSchema>;
export type IntegrationIncident = z.infer<typeof integrationIncidentSchema>;
export const snapshotSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().nonnegative(),
  fingerprint: z.string(),
  monitorFingerprints: z.record(z.string(), z.string()),
  policyFingerprint: z.string(),
  runtimes: z.record(z.string(), runtimeSchema),
  devices: z.array(deviceIncidentSchema).max(500),
  integrations: z.array(integrationIncidentSchema).max(500),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type EventType =
  | 'device_stale'
  | 'device_recovered'
  | 'integration_stale'
  | 'integration_recovered';
export interface WatchdogEvent {
  type: EventType;
  incidentId: string;
  at: number;
  startedAt: number;
  sourceAppId: string;
  sourceAppName: string;
  monitor?: MonitorConfig;
  lastDeliveryAt: number | null;
  affectedDevices: string[];
  affectedCount: number;
  monitoredCount: number;
  recoveredCount: number;
  evidenceKind: string;
}
export function detectionFingerprint(config: WatchdogConfig): string {
  return JSON.stringify({
    policy: config.policy,
    monitors: config.monitors
      .map((m) => ({
        id: m.id,
        sourceAppId: m.sourceAppId,
        deviceId: m.deviceId,
        strategy: m.strategy,
        sourceContract: m.sourceContract,
        expectedIntervalMs: m.expectedIntervalMs,
        staleTimeoutMs: m.staleTimeoutMs,
        enabled: m.enabled,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function monitorFingerprint(m: MonitorConfig): string {
  return detectionFingerprint({
    version: 1,
    monitors: [m],
    policy: policySchema.parse({}),
  });
}
