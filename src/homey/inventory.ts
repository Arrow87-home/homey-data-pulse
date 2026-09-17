export interface CapabilityRecord {
  value?: unknown;
  lastUpdated?: unknown;
  title?: string;
  type?: string;
  getable?: boolean;
  setable?: boolean;
}
export interface DeviceRecord {
  id: string;
  name: string;
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
  zone: string;
  available: boolean | null;
  hasLastSeen: boolean;
  capabilities: { id: string; title: string; type: string }[];
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
  const driver =
    device.driverId?.match(/^homey:app:([^:]+):.+$/)?.[1] ??
    device.driverUri?.match(/^homey:app:([^:]+)$/)?.[1];
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
export function buildInventory(
  devices: Record<string, DeviceRecord>,
  apps: Record<string, AppRecord>,
  zones: Record<string, { name: string }>,
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
      zone: device.zone ? (zones[device.zone]?.name ?? device.zone) : '',
      available: device.available ?? null,
      hasLastSeen: device.lastSeenAt != null,
      capabilities: (
        device.capabilities ?? Object.keys(device.capabilitiesObj ?? {})
      ).map((id) => ({
        id,
        title: device.capabilitiesObj?.[id]?.title ?? id,
        type: device.capabilitiesObj?.[id]?.type ?? 'unknown',
      })),
    });
    groups.set(source.id, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.sourceAppName.localeCompare(b.sourceAppName),
  );
}
