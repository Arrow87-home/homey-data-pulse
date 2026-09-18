import { detectors } from '../core/detectors';
import { WatchdogEngine } from '../core/engine';
import {
  AppRecord,
  buildInventory,
  DeviceRecord,
  identifySource,
  InventoryGroup,
} from './inventory';

type Listener = (...args: unknown[]) => void;
export interface ApiDevice extends DeviceRecord {
  connect(): Promise<void>;
  makeCapabilityInstance(
    id: string,
    listener: (value: unknown) => void,
  ): { destroy(): void };
}
interface Manager {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  on(event: string, listener: Listener): void;
  off(event: string, listener: Listener): void;
}
/** Structural boundary: only the official methods this app actually consumes. */
export interface LocalApi {
  devices: Manager & {
    getDevices(options?: {
      $cache: boolean;
      $timeout: number;
    }): Promise<Record<string, ApiDevice>>;
  };
  apps: { getApps(): Promise<Record<string, AppRecord>> };
  zones: { getZones(): Promise<Record<string, { name: string }>> };
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export class HomeyApiAdapter {
  inventory: InventoryGroup[] = [];
  metadataIncomplete = false;
  inventoryDirty = true;
  private apps: Record<string, AppRecord> = {};
  private zones: Record<string, { name: string }> = {};
  private engine?: WatchdogEngine;
  private listeners = new Map<
    string,
    { device: ApiDevice; handle: { destroy(): void } }
  >();
  private dirty = () => {
    this.inventoryDirty = true;
  };
  constructor(private api: LocalApi) {}

  async start(): Promise<void> {
    for (const event of ['device.create', 'device.update', 'device.delete'])
      this.api.devices.on(event, this.dirty);
    await this.api.devices.connect();
  }
  isConnected(): boolean {
    return this.api.isConnected() && this.api.devices.isConnected();
  }

  async refresh(engine: WatchdogEngine, metadata: boolean): Promise<void> {
    this.engine = engine;
    if (!this.api.devices.isConnected()) await this.api.devices.connect();
    const devices = await this.api.devices.getDevices({
      $cache: false,
      $timeout: 10_000,
    });
    if (metadata) {
      const [apps, zones] = await Promise.allSettled([
        this.api.apps.getApps(),
        this.api.zones.getZones(),
      ]);
      if (apps.status === 'fulfilled') this.apps = apps.value;
      if (zones.status === 'fulfilled') this.zones = zones.value;
      this.metadataIncomplete =
        apps.status === 'rejected' || zones.status === 'rejected';
    }
    this.inventory = buildInventory(devices, this.apps, this.zones);
    const inventoryDevices = new Map(
      this.inventory.flatMap((g) => g.devices).map((d) => [d.deviceId, d]),
    );
    const required = new Set<string>();
    for (const m of engine.config.monitors) {
      const device = devices[m.deviceId];
      const sourceMatches =
        device && identifySource(device).id === m.sourceAppId;
      const capsExist =
        m.strategy.kind !== 'timestamp-capability' ||
        m.strategy.capabilities.every(
          (id) => device?.capabilitiesObj?.[id] !== undefined,
        );
      engine.setPresent(m.id, !!sourceMatches && capsExist);
      if (!m.enabled || !device || !sourceMatches || !capsExist) continue;
      const inventoryDevice = inventoryDevices.get(m.deviceId);
      if (inventoryDevice) {
        m.deviceName = inventoryDevice.deviceName;
        m.zone = inventoryDevice.zone;
        m.sourceAppName = inventoryDevice.sourceAppName;
      }
      if (m.strategy.kind === 'timestamp-capability') {
        // connect() is awaited: makeCapabilityInstance alone swallows subscription errors.
        await device.connect();
        for (const capability of m.strategy.capabilities) {
          const key = `${m.id}/${capability}`;
          required.add(key);
          const existing = this.listeners.get(key);
          if (existing?.device === device) continue;
          existing?.handle.destroy();
          const handle = device.makeCapabilityInstance(capability, (value) => {
            const target = this.engine;
            const current = target?.config.monitors.find(
              (monitor) => monitor.id === m.id,
            );
            if (
              !target ||
              !current ||
              current.deviceId !== device.id ||
              current.sourceAppId !== identifySource(device).id ||
              current.strategy.kind !== 'timestamp-capability' ||
              !current.strategy.capabilities.includes(capability)
            )
              return;
            for (const detector of detectors) {
              const time = detector.read(
                current,
                { capabilities: { [capability]: { value } } },
                target.clock.now(),
              );
              if (time !== null) target.recordDelivery(current.id, time);
            }
          });
          this.listeners.set(key, { device, handle });
        }
      }
    }
    for (const [key, value] of this.listeners)
      if (!required.has(key)) {
        value.handle.destroy();
        this.listeners.delete(key);
      }
    // Resume before consuming snapshots; old data still cannot satisfy the new-evidence gate.
    engine.setObserving(this.isConnected());
    for (const m of engine.config.monitors) {
      const device = devices[m.deviceId];
      if (!device) continue;
      for (const detector of detectors) {
        const time = detector.read(
          m,
          {
            lastSeenAt: device.lastSeenAt,
            capabilities: device.capabilitiesObj,
          },
          engine.clock.now(),
        );
        if (time !== null) engine.recordDelivery(m.id, time);
      }
    }
    this.inventoryDirty = false;
  }

  clearListeners(): void {
    for (const l of this.listeners.values()) l.handle.destroy();
    this.listeners.clear();
  }
  async stop(): Promise<void> {
    this.clearListeners();
    for (const event of ['device.create', 'device.update', 'device.delete'])
      this.api.devices.off(event, this.dirty);
    await this.api.devices.disconnect();
    await this.api.disconnect();
  }
}
