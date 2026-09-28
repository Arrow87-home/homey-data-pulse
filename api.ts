import type App from './app';
import { withUserErrors } from './src/homey/user-errors';
type Request = {
  homey: { app: App; __(key: string): string };
  body: unknown;
  params: Record<string, string>;
};
function service({ homey }: Request) {
  if (!homey.app.service) throw new Error(homey.__('errors.starting'));
  return homey.app.service;
}
export = {
  async getTestSource({ homey }: Request) {
    return homey.app.testSourceStatus();
  },
  async postTestSource({ homey, body }: Request) {
    await homey.app.testSourceAction(
      (body as { action?: unknown } | null)?.action,
    );
    return homey.app.testSourceStatus();
  },
  async getInventory(request: Request) {
    return service(request).adapter.inventory;
  },
  async getStatus(request: Request) {
    return service(request).status();
  },
  async getConfig(request: Request) {
    return service(request).engine.config;
  },
  async putConfig(request: Request) {
    await service(request).configure(request.body);
    return { ok: true };
  },
  async postHeartbeat(request: Request) {
    const body = request.body as { deliveredAt?: unknown } | null;
    return {
      accepted: await withUserErrors(request.homey, () =>
        service(request).heartbeat(request.params.id, body?.deliveredAt),
      ),
    };
  },
};
