import { TEST_APP_ID, TEST_DATA_ID, TEST_DRIVER_ID } from './test-source';
import { parseCapabilityTimestamp } from '../core/detectors';
export interface CapabilityRecord {
  value?: unknown;
  lastUpdated?: unknown;
  title?: string;
  type?: string;
  units?: unknown;
  getable?: boolean;
  setable?: boolean;
}
export interface DeviceRecord {
  id: string;
  name: string;
  data?: { id?: unknown };
  ownerUri?: string;
  driverUri?: string;
  driverId?: string;
  zone?: string;
  available?: boolean;
  lastSeenAt?: unknown;
  capabilitiesObj?: Record<string, CapabilityRecord>;
  capabilities?: string[];
}
export interface AppRecord {
  id: string;
  name?: string | Record<string, string>;
  state?: string;
}
export interface InventoryDevice {
  deviceId: string;
  deviceName: string;
  sourceAppId: string;
  sourceAppName: string;
  identityResolved: boolean;
  /** Display-only metadata for optional same-driver timing shortcuts in settings. */
  driverId?: string;
  zone: string;
  available: boolean | null;
  hasLastSeen: boolean;
  isTestSource?: boolean;
  capabilities: {
    id: string;
    title: string;
    type: string;
    /** Advisory inventory snapshot, never used as runtime evidence. */
    timestampCandidate?: {
      encoding: 'iso' | 'epoch-seconds' | 'epoch-ms';
      at: number;
    };
  }[];
}
export interface InventoryGroup {
  sourceAppId: string;
  sourceAppName: string;
  devices: InventoryDevice[];
}

export function identifySource(device: DeviceRecord): {
  id: string;
  resolved: boolean;
} {
  const owner = device.ownerUri?.match(/^homey:app:([^:]+)$/)?.[1];
  // Modern qualified IDs also include built-in manager drivers, not just apps.
  const qualified = device.driverId?.match(/^homey:([^:]+):([^:]+):(.+)$/);
  let driver = qualified?.[1] === 'app' ? qualified[2] : undefined;
  if (!qualified) {
    // homey-api 3.20's deprecated prototype getter only warns and returns undefined.
    // Old plain API records can carry an actual own data property instead.
    const legacy = Object.getOwnPropertyDescriptor(device, 'driverUri');
    if (legacy && 'value' in legacy && typeof legacy.value === 'string')
      driver = legacy.value.match(/^homey:app:([^:]+)$/)?.[1];
  }
  if (owner && driver && owner !== driver)
    return { id: `unresolved:${device.id}`, resolved: false };
  if (owner || driver) return { id: (owner ?? driver)!, resolved: true };
  if (device.ownerUri?.startsWith('homey:'))
    return { id: device.ownerUri, resolved: false };
  return { id: `unresolved:${device.id}`, resolved: false };
}
function appName(app: AppRecord | undefined, fallback: string): string {
  if (typeof app?.name === 'string') return app.name;
  return app?.name?.en ?? fallback;
}
function timestampCandidate(
  id: string,
  capability: CapabilityRecord | undefined,
  now: number,
): InventoryDevice['capabilities'][number]['timestampCandidate'] {
  if (
    !capability ||
    /^(measure|meter)_/.test(id) ||
    (capability.type &&
      !['string', 'number', 'unknown'].includes(capability.type)) ||
    (capability.units != null &&
      capability.units !== '' &&
      !['s', 'ms'].includes(String(capability.units)))
  )
    return undefined;
  for (const encoding of ['iso', 'epoch-seconds', 'epoch-ms'] as const) {
    const at = parseCapabilityTimestamp(capability.value, encoding);
    if (at !== null && at <= now) return { encoding, at };
  }
  return undefined;
}
export function buildInventory(
  devices: Record<string, DeviceRecord>,
  apps: Record<string, AppRecord>,
  zones: Record<string, { name: string }>,
  now = Date.now(),
): InventoryGroup[] {
  const groups = new Map<string, InventoryGroup>();
  for (const app of Object.values(apps))
    groups.set(app.id, {
      sourceAppId: app.id,
      sourceAppName: appName(app, app.id),
      devices: [],
    });
  for (const device of Object.values(devices)) {
    const source = identifySource(device);
    const sourceAppName = appName(apps[source.id], source.id);
    const group = groups.get(source.id) ?? {
      sourceAppId: source.id,
      sourceAppName,
      devices: [],
    };
    group.devices.push({
      deviceId: device.id,
      deviceName: device.name,
      sourceAppId: source.id,
      sourceAppName,
      identityResolved: source.resolved,
      driverId: device.driverId,
      zone: device.zone ? (zones[device.zone]?.name ?? device.zone) : '',
      available: device.available ?? null,
      hasLastSeen: device.lastSeenAt != null,
      isTestSource:
        source.resolved &&
        source.id === TEST_APP_ID &&
        device.data?.id === TEST_DATA_ID &&
        (device.driverId === `homey:app:${TEST_APP_ID}:${TEST_DRIVER_ID}` ||
          device.driverId === TEST_DRIVER_ID),
      capabilities: (
        device.capabilities ?? Object.keys(device.capabilitiesObj ?? {})
      ).map((id) => ({
        id,
        title: device.capabilitiesObj?.[id]?.title ?? id,
        type: device.capabilitiesObj?.[id]?.type ?? 'unknown',
        timestampCandidate: timestampCandidate(
          id,
          device.capabilitiesObj?.[id],
          now,
        ),
      })),
    });
    groups.set(source.id, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.sourceAppName.localeCompare(b.sourceAppName),
  );
}
