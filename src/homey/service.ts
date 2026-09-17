import { WatchdogEngine } from '../core/engine';
import { parseTimestamp } from '../core/detectors';
import { Clock, configSchema, DEFAULTS, WatchdogEvent } from '../core/model';
import { HomeyApiAdapter } from './api-adapter';
import { Persistence } from './persistence';

export class WatchdogService {
  engine: WatchdogEngine;
  observerStatus = 'starting';
  dispatchFailures = 0;
  private lastSnapshot = -Infinity;
  private lastMetadata = -Infinity;
  private lastCheckpoint = -Infinity;
  private lastTick: number;
  private queue: Promise<unknown> = Promise.resolve();
  private tickInFlight?: Promise<void>;
  private stopped = false;
  constructor(
    private clock: Clock,
    private store: Persistence,
    readonly adapter: HomeyApiAdapter,
    private dispatch: (event: WatchdogEvent) => Promise<void>,
  ) {
    this.engine = new WatchdogEngine(
      store.loadConfig(),
      clock,
      store.loadRuntime(),
    );
    this.engine.setObserving(false);
    this.lastTick = clock.now();
  }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }
  async start(): Promise<void> {
    await this.adapter.start();
    await this.tick();
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.tickInFlight) return this.tickInFlight;
    this.tickInFlight = this.exclusive(() => this.runTick()).finally(() => {
      this.tickInFlight = undefined;
    });
    return this.tickInFlight;
  }
  private async runTick(): Promise<void> {
    const now = this.clock.now();
    if (now < this.lastTick || now - this.lastTick > DEFAULTS.snapshotMs * 2) {
      this.engine.setObserving(false);
      this.lastSnapshot = -Infinity;
    }
    this.lastTick = now;
    if (!this.adapter.isConnected()) {
      this.engine.setObserving(false);
      this.observerStatus = 'disconnected';
    }
    if (
      now - this.lastSnapshot >= DEFAULTS.snapshotMs ||
      this.observerStatus !== 'observing'
    ) {
      // Retry at most once a minute after failures, regardless of manual check requests.
      if (now - this.lastSnapshot < DEFAULTS.snapshotMs) return;
      this.lastSnapshot = now;
      try {
        const metadata =
          now - this.lastMetadata >= DEFAULTS.inventoryMs ||
          this.adapter.inventoryDirty;
        await this.adapter.refresh(this.engine, metadata);
        if (metadata) this.lastMetadata = now;
        if (!this.adapter.isConnected())
          throw new Error('Observer disconnected');
        this.observerStatus = 'observing';
      } catch {
        this.engine.setObserving(false);
        this.observerStatus = 'unavailable';
        return;
      }
    }
    const events = this.engine.evaluate();
    // Persistence before external side effects; failure stops dispatch.
    if (events.length || now - this.lastCheckpoint >= DEFAULTS.snapshotMs) {
      try {
        this.store.saveRuntime(this.engine.snapshot());
        this.lastCheckpoint = now;
      } catch {
        this.engine.setObserving(false);
        this.observerStatus = 'persistence-error';
        throw new Error('Watchdog runtime checkpoint failed');
      }
    }
    for (const event of events) {
      try {
        await this.dispatch(event);
      } catch {
        this.dispatchFailures++;
      }
    }
  }
  configure(value: unknown): Promise<void> {
    return this.exclusive(async () => {
      const config = configSchema.parse(value);
      const inventory = new Map(
        this.adapter.inventory
          .flatMap((g) => g.devices)
          .map((d) => [d.deviceId, d]),
      );
      for (const m of config.monitors) {
        if (
          m.strategy.kind !== 'manual' &&
          m.staleTimeoutMs < DEFAULTS.snapshotMs * 2
        )
          throw new Error(
            'Observed timestamp strategies require staleTimeoutMs >= 120000 to cover snapshot reconciliation',
          );
        const device = inventory.get(m.deviceId);
        if (device && device.sourceAppId !== m.sourceAppId)
          throw new Error('Device/source identity mismatch');
      }
      this.store.saveConfig(config);
      const next = new WatchdogEngine(
        config,
        this.clock,
        this.engine.snapshot(),
      );
      next.setObserving(false);
      this.adapter.clearListeners();
      this.engine = next;
      this.lastSnapshot = -Infinity;
      this.observerStatus = 'starting';
      await this.runTick();
    });
  }
  heartbeat(id: string, deliveredAt: unknown): Promise<boolean> {
    return this.exclusive(async () => {
      if (this.engine.monitor(id).strategy.kind !== 'manual')
        throw new Error('Monitor does not accept manual heartbeats');
      const at = parseTimestamp(deliveredAt, 'iso');
      if (at === null)
        throw new Error('deliveredAt must be an ISO timestamp with timezone');
      const accepted = this.engine.recordDelivery(id, at);
      await this.runTick();
      return accepted;
    });
  }
  status() {
    return {
      observer: this.observerStatus,
      metadataIncomplete: this.adapter.metadataIncomplete,
      dispatchFailures: this.dispatchFailures,
      restore: this.engine.restoreStatus,
      monitors: this.engine.config.monitors.map((m) => ({
        ...m,
        runtime: this.engine.runtimeView(m.id),
      })),
      integrations: [
        ...new Set(this.engine.config.monitors.map((m) => m.sourceAppId)),
      ].map((id) => ({
        sourceAppId: id,
        state: this.engine.integrationStatus(id),
      })),
    };
  }
  async stop(): Promise<void> {
    this.stopped = true;
    await this.exclusive(async () => {
      this.store.saveRuntime(this.engine.snapshot());
      await this.adapter.stop();
    });
  }
}
