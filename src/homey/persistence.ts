import { configSchema, Snapshot, WatchdogConfig } from '../core/model';

export interface Persistence {
  loadConfig(): WatchdogConfig;
  saveConfig(config: WatchdogConfig): void;
  loadRuntime(): unknown;
  saveRuntime(snapshot: Snapshot): void;
}
export interface SettingsPort {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}
export class SettingsPersistence implements Persistence {
  constructor(private settings: SettingsPort) {}
  loadConfig(): WatchdogConfig {
    const value = this.settings.get('watchdog-config');
    return configSchema.parse(value ?? { version: 1, monitors: [] });
  }
  saveConfig(config: WatchdogConfig): void {
    this.settings.set('watchdog-config', configSchema.parse(config));
  }
  loadRuntime(): unknown {
    return this.settings.get('watchdog-runtime') ?? undefined;
  }
  saveRuntime(snapshot: Snapshot): void {
    this.settings.set('watchdog-runtime', snapshot);
  }
}
