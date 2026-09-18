let homey;
let config;
let inventory = [];
let editingId = null;
let saving = false;
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
  resetForm();
  await load();
}
async function load() {
  [config, inventory] = await Promise.all([
    api('GET', '/config', null),
    api('GET', '/inventory', null),
  ]);
  const status = await api('GET', '/status', null);
  if (editingId === null) {
    el('source').replaceChildren(
      ...inventory.map((g) => option(g.sourceAppId, g.sourceAppName)),
    );
    devices();
  }
  el('monitors').replaceChildren(
    ...config.monitors.map((m) => {
      const li = document.createElement('li');
      const r = status.monitors.find((s) => s.id === m.id)?.runtime;
      const text = document.createElement('span');
      text.textContent = `${m.sourceAppName} — ${m.deviceName}: ${r?.state ?? 'UNKNOWN'} (${m.strategy.kind}, timeout ${m.staleTimeoutMs / 60000} min; last delivery ${r?.lastDeliveryAt == null ? 'unconfirmed' : new Date(r.lastDeliveryAt).toISOString()})`;
      const edit = document.createElement('button');
      edit.textContent = 'Edit';
      edit.onclick = () => {
        if (!saving) editMonitor(m);
      };
      const toggle = document.createElement('button');
      toggle.textContent = m.enabled ? 'Disable' : 'Enable';
      toggle.onclick = () =>
        mutate({
          ...config,
          monitors: config.monitors.map((x) =>
            x.id === m.id ? { ...x, enabled: !x.enabled } : x,
          ),
        }).catch(message);
      const remove = document.createElement('button');
      remove.textContent = 'Remove monitor';
      remove.onclick = () =>
        mutate({
          ...config,
          monitors: config.monitors.filter((x) => x.id !== m.id),
        }).catch(message);
      toggle.disabled = remove.disabled = editingId !== null;
      li.append(text, edit, toggle, remove);
      return li;
    }),
  );
  await loadTestSource();
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
function formMode() {
  const editing = editingId !== null;
  el('form-title').textContent = editing ? 'Edit monitor' : 'Add monitor';
  el('add').textContent = editing ? 'Save changes' : 'Add monitor';
  el('cancel').hidden = !editing;
  el('source').disabled = el('device').disabled = editing;
}
function resetForm() {
  editingId = null;
  formMode();
  el('enabled').checked = true;
  el('strategy').value = 'manual';
  el('encoding').value = 'iso';
  el('expected').value = '5';
  el('timeout').value = '15';
  el('contract').value = '';
  el('source').replaceChildren(
    ...inventory.map((g) => option(g.sourceAppId, g.sourceAppName)),
  );
  devices();
}
function editMonitor(monitor) {
  editingId = monitor.id;
  formMode();
  // Preserve configuration even when a saved source/capability is currently absent.
  el('source').replaceChildren(
    option(monitor.sourceAppId, monitor.sourceAppName),
  );
  el('device').replaceChildren(option(monitor.deviceId, monitor.deviceName));
  capabilities();
  const selected = monitor.strategy.capabilities ?? [];
  for (const id of selected) {
    if (!Array.from(el('capabilities').options).some((o) => o.value === id))
      el('capabilities').append(
        option(id, `${id} (not currently inventoried)`),
      );
  }
  for (const o of el('capabilities').options)
    o.selected = selected.includes(o.value);
  el('strategy').value = monitor.strategy.kind;
  el('encoding').value = monitor.strategy.encoding ?? 'iso';
  el('expected').value = String(monitor.expectedIntervalMs / 60000);
  el('timeout').value = String(monitor.staleTimeoutMs / 60000);
  el('contract').value = monitor.sourceContract;
  el('enabled').checked = monitor.enabled;
  // Disable destructive list controls until save/cancel.
  for (const li of el('monitors').children) {
    li.children[2].disabled = li.children[3].disabled = true;
  }
}
async function mutate(next) {
  if (saving) return;
  saving = true;
  el('add').disabled = el('cancel').disabled = true;
  try {
    await save(next);
  } finally {
    saving = false;
    el('add').disabled = el('cancel').disabled = false;
  }
}
async function loadTestSource() {
  const source = await api('GET', '/test-source', null);
  el('test-status').textContent = !source.paired
    ? 'Not paired. Add Data Watchdog Test Source via Devices → Add device.'
    : `Heartbeat: ${source.running ? 'running' : 'stopped'}\nLast generated: ${source.lastGeneratedAt ?? 'never'}\nInterval: ${source.intervalMs / 1000}s; restart: stopped\nNative lastSeenAt: ${source.nativeLastSeen}\nManual deliveries on last heartbeat: ${source.manualDeliveries}\n${source.lastError ?? ''}`;
  for (const action of ['start', 'stop', 'send'])
    el(`test-${action}`).disabled = !source.paired;
}
function onHomeyReady(Homey) {
  homey = Homey;
  homey.ready();
  el('enabled').checked = true;
  el('source').onchange = devices;
  el('device').onchange = capabilities;
  el('refresh').onclick = () => {
    if (!saving) load().catch(message);
  };
  el('cancel').onclick = () => {
    if (saving) return;
    resetForm();
    load().catch(message);
    message('Changes cancelled');
  };
  for (const action of ['start', 'stop', 'send']) {
    el(`test-${action}`).onclick = async () => {
      try {
        await api('POST', '/test-source', { action });
        await load();
      } catch (error) {
        message(error);
      }
    };
  }
  el('add').onclick = async () => {
    if (saving) return;
    try {
      const original =
        editingId === null
          ? null
          : config.monitors.find((m) => m.id === editingId);
      if (editingId !== null && !original)
        throw new Error('Monitor no longer exists; cancel and refresh');
      const device = inventory
        .flatMap((g) => g.devices)
        .find((d) => d.deviceId === el('device').value);
      if (!original && !device) throw new Error('Choose an inventoried device');
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
        ...(original ?? {
          id: device.deviceId,
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          sourceAppId: device.sourceAppId,
          sourceAppName: device.sourceAppName,
          zone: device.zone,
        }),
        strategy,
        sourceContract: el('contract').value,
        expectedIntervalMs: Number(el('expected').value) * 60000,
        staleTimeoutMs: Number(el('timeout').value) * 60000,
        enabled: el('enabled').checked,
      };
      await mutate({
        ...config,
        monitors: original
          ? config.monitors.map((m) => (m.id === original.id ? monitor : m))
          : [...config.monitors, monitor],
      });
      message('Monitor saved');
    } catch (error) {
      message(error);
    }
  };
  load().catch(message);
}
window.onHomeyReady = onHomeyReady;
