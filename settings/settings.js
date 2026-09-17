let homey;
let config;
let inventory = [];
const el = (id) => document.getElementById(id);
const api = (method, path, body) =>
  new Promise((resolve, reject) =>
    homey.api(method, path, body, (err, value) =>
      err ? reject(err) : resolve(value),
    ),
  );
const message = (error) => {
  el('message').textContent =
    error instanceof Error ? error.message : String(error);
};
const option = (value, label) => {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
};
function devices() {
  const group = inventory.find((g) => g.sourceAppId === el('source').value);
  el('device').replaceChildren(
    ...(group?.devices ?? []).map((d) => option(d.deviceId, d.deviceName)),
  );
  capabilities();
}
function capabilities() {
  const device = inventory
    .flatMap((g) => g.devices)
    .find((d) => d.deviceId === el('device').value);
  el('capabilities').replaceChildren(
    ...(device?.capabilities ?? []).map((c) =>
      option(c.id, `${c.title} (${c.id})`),
    ),
  );
}
async function save(next) {
  await api('PUT', '/config', next);
  await load();
}
async function load() {
  [config, inventory] = await Promise.all([
    api('GET', '/config', null),
    api('GET', '/inventory', null),
  ]);
  const status = await api('GET', '/status', null);
  el('source').replaceChildren(
    ...inventory.map((g) => option(g.sourceAppId, g.sourceAppName)),
  );
  devices();
  el('monitors').replaceChildren(
    ...config.monitors.map((m) => {
      const li = document.createElement('li');
      const r = status.monitors.find((s) => s.id === m.id)?.runtime;
      const text = document.createElement('span');
      text.textContent = `${m.sourceAppName} — ${m.deviceName}: ${r?.state ?? 'UNKNOWN'} (${m.strategy.kind}, timeout ${m.staleTimeoutMs / 60000} min)`;
      const toggle = document.createElement('button');
      toggle.textContent = m.enabled ? 'Disable' : 'Enable';
      toggle.onclick = () =>
        save({
          ...config,
          monitors: config.monitors.map((x) =>
            x.id === m.id ? { ...x, enabled: !x.enabled } : x,
          ),
        }).catch(message);
      const remove = document.createElement('button');
      remove.textContent = 'Remove monitor';
      remove.onclick = () =>
        save({
          ...config,
          monitors: config.monitors.filter((x) => x.id !== m.id),
        }).catch(message);
      li.append(text, toggle, remove);
      return li;
    }),
  );
  el('status').textContent = JSON.stringify(
    {
      observer: status.observer,
      metadataIncomplete: status.metadataIncomplete,
      dispatchFailures: status.dispatchFailures,
      restore: status.restore,
      integrations: status.integrations,
    },
    null,
    2,
  );
}
function onHomeyReady(Homey) {
  homey = Homey;
  homey.ready();
  el('source').onchange = devices;
  el('device').onchange = capabilities;
  el('refresh').onclick = () => load().catch(message);
  el('add').onclick = async () => {
    try {
      const device = inventory
        .flatMap((g) => g.devices)
        .find((d) => d.deviceId === el('device').value);
      if (!device) throw new Error('Choose an inventoried device');
      const kind = el('strategy').value;
      const strategy =
        kind === 'timestamp-capability'
          ? {
              kind,
              capabilities: Array.from(el('capabilities').selectedOptions).map(
                (o) => o.value,
              ),
              encoding: el('encoding').value,
            }
          : { kind };
      const monitor = {
        id: device.deviceId,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        sourceAppId: device.sourceAppId,
        sourceAppName: device.sourceAppName,
        zone: device.zone,
        strategy,
        sourceContract: el('contract').value,
        expectedIntervalMs: Number(el('expected').value) * 60000,
        staleTimeoutMs: Number(el('timeout').value) * 60000,
        enabled: true,
      };
      await save({ ...config, monitors: [...config.monitors, monitor] });
      message('Monitor saved');
    } catch (error) {
      message(error);
    }
  };
  load().catch(message);
}
window.onHomeyReady = onHomeyReady;
