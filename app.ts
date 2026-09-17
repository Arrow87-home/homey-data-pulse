import Homey from 'homey';
import { HomeyAPI } from 'homey-api';
import { DEFAULTS, WatchdogEvent } from './src/core/model';
import { HomeyApiAdapter, LocalApi } from './src/homey/api-adapter';
import { SettingsPersistence } from './src/homey/persistence';
import { WatchdogService } from './src/homey/service';
import { flowTokens } from './src/homey/tokens';

class DataWatchdogApp extends Homey.App {
  service?: WatchdogService;
  private timer?: NodeJS.Timeout;
  async onInit(): Promise<void> {
    if (this.homey.platform !== 'local' || this.homey.platformVersion !== 2)
      throw new Error(
        'This version requires Homey SHS or Homey Pro 2023/mini/2026 (local platform v2)',
      );
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
      'Data Watchdog initialized; configured monitors:',
      this.service.engine.config.monitors.length,
    );
  }
  private async dispatch(event: WatchdogEvent): Promise<void> {
    const tokens = flowTokens(event);
    // Independent attempts: a failed specialized trigger must not skip the generic trigger.
    const results = await Promise.allSettled([
      this.homey.flow.getTriggerCard(event.type).trigger(tokens),
      this.homey.flow
        .getTriggerCard(
          event.type.endsWith('_recovered')
            ? 'any_incident_recovered'
            : 'any_incident_started',
        )
        .trigger(tokens),
    ]);
    if (results.some((r) => r.status === 'rejected'))
      throw new Error('Flow dispatch failed');
  }
  private registerFlows(): void {
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
        .registerRunListener(
          async (args: { monitor: { id: string } }) =>
            service.engine.status(args.monitor.id) ===
            (state === 'healthy' ? 'HEALTHY' : 'DEVICE_STALE'),
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
      await service.tick();
      return true;
    });
    this.homey.flow
      .getActionCard('check_monitor')
      .registerArgumentAutocompleteListener('monitor', async (query) =>
        monitorChoices(query),
      )
      .registerRunListener(async (args: { monitor: { id: string } }) => {
        service.engine.monitor(args.monitor.id);
        await service.tick();
        return true;
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
          service.heartbeat(args.monitor.id, args.delivered_at),
      );
  }
  async onUninit(): Promise<void> {
    if (this.timer) this.homey.clearInterval(this.timer);
    await this.service?.stop();
  }
}
export = DataWatchdogApp;
