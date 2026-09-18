import Homey from 'homey';
import type App from '../../app';
import {
  TestSource,
  TEST_CAPABILITY,
  deliverTestHeartbeat,
} from '../../src/homey/test-source';

class TestSourceDevice extends Homey.Device {
  private source?: TestSource;
  async onInit(): Promise<void> {
    await this.cleanup();
    const app = this.homey.app as App;
    // Official SDK >=12.6.1; not yet declared in the pinned SDK type package.
    const native = (
      this as Homey.Device & { setLastSeenAt?: () => Promise<void> }
    ).setLastSeenAt;
    this.source = new TestSource(
      {
        now: () => Date.now(),
        setTimeout: (callback, delay) => this.homey.setTimeout(callback, delay),
        clearTimeout: (handle) =>
          this.homey.clearTimeout(handle as NodeJS.Timeout),
        writeTimestamp: (iso) => this.setCapabilityValue(TEST_CAPABILITY, iso),
        markLastSeen: native ? () => native.call(this) : undefined,
        deliverManual: async (iso) =>
          app.service ? deliverTestHeartbeat(app.service, iso) : 0,
      },
      this.getCapabilityValue(TEST_CAPABILITY),
    );
    app.registerTestSource(this.source);
  }
  private async cleanup(): Promise<void> {
    if (!this.source) return;
    await this.source.dispose();
    (this.homey.app as App).unregisterTestSource(this.source);
    this.source = undefined;
  }
  async onDeleted(): Promise<void> {
    await this.cleanup();
  }
  async onUninit(): Promise<void> {
    await this.cleanup();
  }
}
export = TestSourceDevice;
