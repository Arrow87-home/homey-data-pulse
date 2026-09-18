import Homey from 'homey';
import { TEST_DATA_ID } from '../../src/homey/test-source';

class TestSourceDriver extends Homey.Driver {
  async onPairListDevices() {
    if (this.getDevices().length) return [];
    return [
      {
        name: 'Data Watchdog Test Source (simulation)',
        data: { id: TEST_DATA_ID },
      },
    ];
  }
}
export = TestSourceDriver;
