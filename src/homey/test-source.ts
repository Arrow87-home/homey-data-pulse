import type { WatchdogService } from './service';

export const TEST_APP_ID = 'io.github.arrow87-home.datawatchdog';
export const TEST_DRIVER_ID = 'test-source';
export const TEST_DATA_ID = 'watchdog-local-test-source';
export const TEST_CAPABILITY = 'last_test_heartbeat';
export const TEST_INTERVAL_MS = 30_000;
export type TestAction = 'start' | 'stop' | 'send';

export interface TestSourcePorts {
  now(): number;
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
  writeTimestamp(iso: string): Promise<void>;
  markLastSeen?: () => Promise<void>;
  deliverManual(iso: string): Promise<number>;
}

/** Own-device activity only. No engine, synthetic incidents, or persisted enabled flag. */
export class TestSource {
  private running = false;
  private disposed = false;
  private timer?: unknown;
  private generation = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private lastGeneratedAt: string | null;
  private lastSeen: 'unavailable' | 'not-sent' | 'sent' | 'failed';
  private lastError: string | null = null;
  private manualDeliveries = 0;

  constructor(
    private readonly ports: TestSourcePorts,
    previousTimestamp?: unknown,
  ) {
    this.lastGeneratedAt =
      typeof previousTimestamp === 'string' ? previousTimestamp : null;
    this.lastSeen = ports.markLastSeen ? 'not-sent' : 'unavailable';
  }

  status() {
    return {
      paired: !this.disposed,
      running: this.running,
      lastGeneratedAt: this.lastGeneratedAt,
      intervalMs: TEST_INTERVAL_MS,
      nativeLastSeen: this.lastSeen,
      manualDeliveries: this.manualDeliveries,
      lastError: this.lastError,
      restartPolicy: 'stopped',
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.tail.then(operation);
    this.tail = task.catch(() => undefined);
    return task;
  }

  action(action: TestAction): Promise<void> {
    return this.enqueue(async () => {
      if (this.disposed) throw new Error('Test source has been removed');
      if (action === 'stop') {
        this.running = false;
        this.cancelTimer();
        return;
      }
      if (action === 'start' && this.running) return;
      if (action === 'start') this.running = true;
      try {
        await this.beat();
        if (action === 'start') this.schedule();
      } catch (error) {
        this.running = false;
        this.cancelTimer();
        this.lastError = 'Test heartbeat failed; source stopped';
        throw error;
      }
    });
  }

  private async beat(): Promise<void> {
    const now = this.ports.now();
    // Never fabricate a newer/future time for two commands in the same millisecond.
    if (this.lastGeneratedAt && Date.parse(this.lastGeneratedAt) >= now) return;
    const iso = new Date(now).toISOString();
    await this.ports.writeTimestamp(iso);
    this.lastGeneratedAt = iso;
    this.lastError = null;
    if (this.ports.markLastSeen) {
      try {
        await this.ports.markLastSeen(); // Native SDK supplies the actual time; no argument.
        this.lastSeen = 'sent';
      } catch {
        this.lastSeen = 'failed';
        this.lastError =
          'Native lastSeenAt update failed; timestamp/manual remain available';
      }
    }
    this.manualDeliveries = await this.ports.deliverManual(iso);
  }

  private cancelTimer(): void {
    this.generation++;
    if (this.timer !== undefined) this.ports.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (!this.running || this.disposed) return;
    this.cancelTimer();
    const generation = this.generation;
    this.timer = this.ports.setTimeout(() => {
      this.timer = undefined;
      void this.enqueue(async () => {
        if (!this.running || this.disposed || generation !== this.generation)
          return;
        try {
          await this.beat();
          this.schedule();
        } catch {
          this.running = false;
          this.cancelTimer();
          this.lastError = 'Test heartbeat failed; source stopped';
        }
      });
    }, TEST_INTERVAL_MS);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.running = false;
    this.cancelTimer();
    await this.tail; // No writes can occur after cleanup resolves.
  }
}

/** Route only the uniquely identified, app-owned test device through production heartbeat code. */
export async function deliverTestHeartbeat(
  service: WatchdogService,
  iso: string,
): Promise<number> {
  const devices = service.adapter.inventory
    .flatMap((group) => group.devices)
    .filter(
      (device) => device.isTestSource && device.sourceAppId === TEST_APP_ID,
    );
  if (devices.length !== 1) return 0;
  const deviceId = devices[0].deviceId;
  const monitor = service.engine.config.monitors.find(
    (m) =>
      m.enabled &&
      m.deviceId === deviceId &&
      m.sourceAppId === TEST_APP_ID &&
      m.strategy.kind === 'manual',
  );
  if (!monitor) return 0;
  return Number(
    await service.heartbeat(monitor.id, iso, {
      deviceId,
      sourceAppId: TEST_APP_ID,
    }),
  );
}
