import Homey from 'homey';
import { HomeyAPI } from 'homey-api';
import { DEFAULTS, WatchdogEvent } from './src/core/model';
import { HomeyApiAdapter, LocalApi } from './src/homey/api-adapter';
import { SettingsPersistence } from './src/homey/persistence';
import { WatchdogService } from './src/homey/service';
import { dispatchFlows } from './src/homey/flows';
import { TestSource, TestAction } from './src/homey/test-source';
import { withUserErrors } from './src/homey/user-errors';

class DataWatchdogApp extends Homey.App {
  service?: WatchdogService;
  private timer?: NodeJS.Timeout;
  async onInit(): Promise<void> {
    if (this.homey.platform !== 'local')
      throw new Error(this.homey.__('errors.unsupportedPlatform'));
    const api = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.service = new WatchdogService(
      { now: () => Date.now() },
      new SettingsPersistence(this.homey.settings),
      new HomeyApiAdapter(api as unknown as LocalApi),
      (event) => this.dispatch(event),
    );
    this.registerFlows();
    try {
      await this.service.start();
    } catch {
      this.error('Watchdog observation unavailable; scheduler will retry');
    }
    this.timer = this.homey.setInterval(() => {
      this.service
        ?.tick()
        .catch(() => this.error('Watchdog evaluation/checkpoint failed'));
    }, DEFAULTS.schedulerMs);
    this.log(
      'Data Pulse initialized; configured monitors:',
      this.service.engine.config.monitors.length,
    );
  }
  private async dispatch(event: WatchdogEvent): Promise<void> {
    await dispatchFlows(this.homey.flow, event);
  }
  private testSource?: TestSource;
  registerTestSource(source: TestSource): void {
    if (this.testSource && this.testSource !== source)
      throw new Error(this.homey.__('errors.singleTestSource'));
    this.testSource = source;
  }
  unregisterTestSource(source: TestSource): void {
    if (this.testSource === source) this.testSource = undefined;
  }
  testSourceStatus() {
    return this.testSource?.status() ?? { paired: false };
  }
  async testSourceAction(action: unknown): Promise<void> {
    return withUserErrors(this.homey, async () => {
      if (action !== 'start' && action !== 'stop' && action !== 'send')
        throw new Error('Unknown test source action');
      if (!this.testSource)
        throw new Error('Add the Data Pulse Test Source device first');
      await this.testSource.action(action);
    });
  }

  private registerFlows(): void {
    for (const action of ['start', 'stop', 'send'] as TestAction[]) {
      this.homey.flow
        .getActionCard(`${action}_test_heartbeat`)
        .registerRunListener(async () => {
          await this.testSourceAction(action);
          return true;
        });
    }
    const service = this.service!;
    const monitorChoices = (query: string) =>
      service.engine.config.monitors
        .filter((m) =>
          `${m.sourceAppName} ${m.deviceName}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .map((m) => ({
          id: m.id,
          name: `${m.sourceAppName} — ${m.deviceName}`,
        }));
    const sourceChoices = (query: string) =>
      [
        ...new Map(
          service.engine.config.monitors.map((m) => [
            m.sourceAppId,
            { id: m.sourceAppId, name: m.sourceAppName },
          ]),
        ).values(),
      ].filter((s) => s.name.toLowerCase().includes(query.toLowerCase()));
    for (const state of ['healthy', 'stale']) {
      this.homey.flow
        .getConditionCard(`device_is_${state}`)
        .registerArgumentAutocompleteListener('monitor', async (query) =>
          monitorChoices(query),
        )
        .registerRunListener(async (args: { monitor: { id: string } }) =>
          withUserErrors(
            this.homey,
            () =>
              service.engine.status(args.monitor.id) ===
              (state === 'healthy' ? 'HEALTHY' : 'DEVICE_STALE'),
          ),
        );
      this.homey.flow
        .getConditionCard(`integration_is_${state}`)
        .registerArgumentAutocompleteListener('source', async (query) =>
          sourceChoices(query),
        )
        .registerRunListener(
          async (args: { source: { id: string } }) =>
            service.engine.integrationStatus(args.source.id) ===
            (state === 'healthy' ? 'HEALTHY' : 'INTEGRATION_STALE'),
        );
    }
    this.homey.flow.getActionCard('check_all').registerRunListener(async () => {
      return withUserErrors(this.homey, async () => {
        await service.tick();
        return true;
      });
    });
    this.homey.flow
      .getActionCard('check_monitor')
      .registerArgumentAutocompleteListener('monitor', async (query) =>
        monitorChoices(query),
      )
      .registerRunListener(async (args: { monitor: { id: string } }) => {
        return withUserErrors(this.homey, async () => {
          service.engine.monitor(args.monitor.id);
          await service.tick();
          return true;
        });
      });
    this.homey.flow
      .getActionCard('record_heartbeat')
      .registerArgumentAutocompleteListener('monitor', async (query) =>
        monitorChoices(query).filter(
          (c) => service.engine.monitor(c.id).strategy.kind === 'manual',
        ),
      )
      .registerRunListener(
        async (args: { monitor: { id: string }; delivered_at: string }) =>
          withUserErrors(this.homey, () =>
            service.heartbeat(args.monitor.id, args.delivered_at),
          ),
      );
  }
  async onUninit(): Promise<void> {
    if (this.timer) this.homey.clearInterval(this.timer);
    await this.testSource?.dispose();
    await this.service?.stop();
  }
}
export = DataWatchdogApp;
