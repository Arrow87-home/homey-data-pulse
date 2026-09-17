import type App from './app';
type Request = {
  homey: { app: App };
  body: unknown;
  params: Record<string, string>;
};
function service({ homey }: Request) {
  if (!homey.app.service) throw new Error('Watchdog is starting');
  return homey.app.service;
}
export = {
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
      accepted: await service(request).heartbeat(
        request.params.id,
        body?.deliveredAt,
      ),
    };
  },
};
