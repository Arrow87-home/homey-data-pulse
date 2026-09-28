import Homey from 'homey';
import { TEST_DATA_ID } from '../../src/homey/test-source';

class TestSourceDriver extends Homey.Driver {
  async onPairListDevices() {
    if (this.getDevices().length) return [];
    return [
      {
        name: this.homey.__('testSourceName'),
        data: { id: TEST_DATA_ID },
      },
    ];
  }
}
export = TestSourceDriver;
