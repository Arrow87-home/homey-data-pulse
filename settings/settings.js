let homey;
let config;
let inventory = [];
let editingId = null;
let saving = false;
let initialized = false;
let capabilityChoices = [];
let errors = {};
let latestStatus = { monitors: [], integrations: [] };
const kinds = ['device-last-seen', 'timestamp-capability', 'manual'];
const fields = [
  'source',
  'device',
  'strategy',
  'capabilities',
  'encoding',
  'expected',
  'timeout',
  'contract',
];
// User-facing dynamic copy is centralized so it can move to Homey translations later.
const copy = {
  methods: {
    'device-last-seen': 'Device activity',
    'timestamp-capability': 'Delivery timestamp',
    manual: 'Explicit heartbeat',
  },
  selectSource: 'Select an integration first.',
  selectDevice:
    'Select a device first. If it is missing, refresh the inventory.',
  selectCapability:
    'Select which timestamp indicates that new data has been received.',
  timingOrder:
    'Consider stale after must be equal to or longer than the expected update interval.',
  observedMinimum:
    'Activity and timestamp checks require a stale timeout of at least 2 minutes.',
  invalidTiming:
    'Enter a duration greater than zero, up to 525600 minutes (whole milliseconds).',
  failed: 'The monitor could not be saved. Check the highlighted fields.',
  retry:
    'The monitor could not be saved. Try again; your changes are still here.',
};
const el = (id) => document.getElementById(id);
const api = (method, path, body) =>
  new Promise((resolve, reject) =>
    homey.api(method, path, body, (err, value) =>
      err ? reject(err) : resolve(value),
    ),
  );
const errorText = (error) =>
  typeof error === 'string'
    ? error
    : (error?.message ?? 'An unexpected error occurred.');
function announce(id, text, error = false) {
  el(id).textContent = text;
  el(id).className = error ? 'action-message error' : 'action-message';
}
function node(tag, text = '', className = '') {
  const item = document.createElement(tag);
  item.textContent = text;
  item.className = className;
  return item;
}
function option(value, title) {
  const item = node('option', title);
  item.value = value;
  return item;
}
function badge(state) {
  const item = node('span', state, 'badge');
  item.setAttribute('data-state', state);
  return item;
}
function date(value, exact = false) {
  if (value == null || value === '') return 'Never';
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? 'Unknown'
    : exact
      ? time.toISOString()
      : time.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
}
function rows(target, entries) {
  target.replaceChildren(
    ...entries.flatMap(([key, value]) => [
      node('dt', key),
      node('dd', String(value)),
    ]),
  );
}
function kind() {
  return kinds.find((value) => el(`strategy-${value}`).checked);
}
function setKind(value) {
  for (const k of kinds) el(`strategy-${k}`).checked = k === value;
  timestampVisibility();
}
function selectedCapabilities() {
  return capabilityChoices
    .filter((input) => input.checked)
    .map((input) => input.value);
}
function selectedDevice() {
  return inventory
    .flatMap((g) => g.devices)
    .find(
      (d) =>
        d.deviceId === el('device').value &&
        d.sourceAppId === el('source').value,
    );
}
function timestampVisibility() {
  el('timestamp-fields').hidden = kind() !== 'timestamp-capability';
}

function sources() {
  el('source').replaceChildren(
    option('', 'Choose an integration'),
    ...inventory.map((g) => option(g.sourceAppId, g.sourceAppName)),
  );
  if (inventory.length === 1) el('source').value = inventory[0].sourceAppId;
  devices();
}
function devices() {
  const group = inventory.find((g) => g.sourceAppId === el('source').value);
  el('device').replaceChildren(
    option('', 'Choose a device'),
    ...(group?.devices ?? []).map((d) => option(d.deviceId, d.deviceName)),
  );
  if (group?.devices.length === 1)
    el('device').value = group.devices[0].deviceId;
  capabilities();
}
function capabilities(saved) {
  // Types constrain the encoding, not the source's delivery contract. No measurement
  // value or lastUpdated is ever promoted to a timestamp by this UI.
  const available = (selectedDevice()?.capabilities ?? []).filter(
    (c) => !c.type || ['string', 'number', 'unknown'].includes(c.type),
  );
  const choices = [...available];
  for (const id of saved ?? [])
    if (!choices.some((c) => c.id === id))
      choices.push({ id, title: id, missing: true });
  const selected = saved ?? (available.length === 1 ? [available[0].id] : []);
  capabilityChoices = [];
  el('capability-options').replaceChildren(
    ...choices.map((capability, index) => {
      const label = node('label', '', 'choice');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = capability.id;
      input.id = `capability-${index}`;
      input.checked = selected.includes(capability.id);
      input.setAttribute(
        'aria-describedby',
        'capabilities-help capabilities-error',
      );
      input.onchange = correctErrors;
      const text = node('span');
      text.append(
        node('strong', capability.title),
        node('small', capability.id, 'capability-id'),
      );
      if (capability.missing)
        text.append(
          node('small', 'Saved field; not currently in the inventory.'),
        );
      label.append(input, text);
      capabilityChoices.push(input);
      return label;
    }),
  );
  el('capabilities-empty').hidden = choices.length !== 0;
}
function formMode() {
  const editing = editingId !== null;
  el('form-title').textContent = editing ? 'Edit monitor' : 'Add monitor';
  el('add').textContent = saving
    ? 'Saving…'
    : editing
      ? 'Save changes'
      : 'Add monitor';
  el('cancel').hidden = !editing;
  el('source').disabled = el('device').disabled = editing;
  el('draft-fields').disabled = saving;
  el('add').disabled =
    el('cancel').disabled =
    el('refresh').disabled =
      saving || !config;
}
function resetForm() {
  editingId = null;
  errors = {};
  renderErrors();
  el('save-details').hidden = true;
  el('advanced').open = false;
  el('enabled').checked = true;
  setKind('manual');
  el('encoding').value = 'iso';
  el('expected').value = '5';
  el('timeout').value = '15';
  el('contract').value = '';
  sources();
  formMode();
}
function editMonitor(monitor) {
  if (saving) return;
  editingId = monitor.id;
  errors = {};
  renderErrors();
  announce('form-message', '');
  el('save-details').hidden = true;
  el('source').replaceChildren(
    option(monitor.sourceAppId, monitor.sourceAppName),
  );
  el('device').replaceChildren(option(monitor.deviceId, monitor.deviceName));
  capabilities(
    monitor.strategy.kind === 'timestamp-capability'
      ? monitor.strategy.capabilities
      : undefined,
  );
  setKind(monitor.strategy.kind);
  el('encoding').value = monitor.strategy.encoding ?? 'iso';
  el('expected').value = String(monitor.expectedIntervalMs / 60000);
  el('timeout').value = String(monitor.staleTimeoutMs / 60000);
  el('contract').value = monitor.sourceContract ?? '';
  el('enabled').checked = monitor.enabled;
  formMode();
  renderMonitors();
  el('form-title').scrollIntoView({ block: 'start', behavior: 'auto' });
  el(`strategy-${monitor.strategy.kind}`).focus({ preventScroll: true });
}
function validate() {
  const issues = {};
  if (!el('source').value) issues.source = copy.selectSource;
  if (!el('device').value || (editingId === null && !selectedDevice()))
    issues.device = copy.selectDevice;
  if (
    editingId === null &&
    config?.monitors.some((m) => m.deviceId === el('device').value)
  )
    issues.device = 'This device already has a monitor. Use Edit on its card.';
  if (!kind()) issues.strategy = 'Choose how freshness should be checked.';
  if (kind() === 'timestamp-capability') {
    if (!selectedCapabilities().length)
      issues.capabilities = copy.selectCapability;
    else if (selectedCapabilities().length > 16)
      issues.capabilities = 'Select no more than 16 timestamp fields.';
    if (!['iso', 'epoch-seconds', 'epoch-ms'].includes(el('encoding').value))
      issues.encoding = 'Select the timestamp format used by the source.';
  }
  for (const field of ['expected', 'timeout']) {
    const milliseconds = Number(el(field).value) * 60000;
    if (
      !Number.isInteger(milliseconds) ||
      milliseconds <= 0 ||
      milliseconds > 365 * 86400000
    )
      issues[field] = copy.invalidTiming;
  }
  if (
    !issues.timeout &&
    !issues.expected &&
    Number(el('timeout').value) < Number(el('expected').value)
  )
    issues.timeout = copy.timingOrder;
  if (!issues.timeout && kind() !== 'manual' && Number(el('timeout').value) < 2)
    issues.timeout = copy.observedMinimum;
  if (el('contract').value.length > 2000)
    issues.contract = 'Keep the technical note within 2000 characters.';
  return issues;
}
function renderErrors() {
  for (const field of fields) {
    el(`${field}-error`).textContent = errors[field] ?? '';
    el(`${field}-error`).hidden = !errors[field];
    el(field).setAttribute('aria-invalid', errors[field] ? 'true' : 'false');
  }
}
function focusError() {
  const first = fields.find((field) => errors[field]);
  if (first === 'contract') el('advanced').open = true;
  const target =
    first === 'strategy'
      ? el('strategy-device-last-seen')
      : first === 'capabilities'
        ? (capabilityChoices[0] ?? el(first))
        : el(first ?? 'form-message');
  target.scrollIntoView({ block: 'center', behavior: 'auto' });
  (target.disabled ? el('form-message') : target).focus({
    preventScroll: true,
  });
}
function correctErrors() {
  const corrected = validate();
  for (const field of Object.keys(errors)) {
    if (!corrected[field]) delete errors[field];
    else errors[field] = corrected[field];
  }
  renderErrors();
  if (!Object.keys(errors).length) announce('form-message', '');
}
function saveError(error, next) {
  errors = {};
  const raw = errorText(error);
  let issues = error?.issues;
  if (!issues) {
    try {
      const decoded = JSON.parse(raw);
      issues = Array.isArray(decoded) ? decoded : decoded.issues;
    } catch {
      /* Non-Zod transport error. */
    }
  }
  const fieldMap = {
    sourceAppId: 'source',
    deviceId: 'device',
    strategy: 'strategy',
    capabilities: 'capabilities',
    encoding: 'encoding',
    expectedIntervalMs: 'expected',
    staleTimeoutMs: 'timeout',
    sourceContract: 'contract',
  };
  const draftIndex =
    editingId === null
      ? next.monitors.length - 1
      : next.monitors.findIndex((m) => m.id === editingId);
  if (Array.isArray(issues))
    for (const issue of issues) {
      const path = issue.path ?? [];
      if (path[0] === 'monitors' && path[1] !== draftIndex) continue;
      const field =
        fieldMap[path.at(-1)] ??
        (path.includes('capabilities') ? 'capabilities' : undefined);
      if (field)
        errors[field] = {
          capabilities: copy.selectCapability,
          expected: copy.invalidTiming,
          timeout:
            issue.code === 'custom' ? copy.timingOrder : copy.invalidTiming,
          contract: 'Keep the optional note within 2000 characters.',
          source: copy.selectSource,
          device: copy.selectDevice,
          strategy: 'Choose a supported freshness check.',
          encoding: 'Select a supported timestamp format.',
        }[field];
    }
  if (raw.includes('120000')) errors.timeout = copy.observedMinimum;
  if (/Duplicate (deviceId|id)/.test(raw))
    errors.device =
      'This device already has a monitor. Refresh and edit the existing monitor.';
  if (/identity mismatch/.test(raw))
    errors.device =
      'This device no longer belongs to the selected integration. Refresh and check the device.';
  renderErrors();
  announce(
    'form-message',
    Object.keys(errors).length ? copy.failed : copy.retry,
    true,
  );
  el('save-error-detail').textContent = raw;
  el('save-details').hidden = false;
  focusError();
}
async function writeConfig(next, reset = false) {
  saving = true;
  formMode();
  renderMonitors();
  try {
    await api('PUT', '/config', next);
    config = next; // Reflect a confirmed write even if a subsequent status fetch fails.
    if (reset) resetForm();
    renderMonitors();
    let refreshed = true;
    try {
      await load();
    } catch {
      refreshed = false;
    }
    return refreshed;
  } finally {
    saving = false;
    formMode();
    renderMonitors();
  }
}
async function submit(event) {
  event.preventDefault();
  if (saving || !config) return;
  errors = validate();
  renderErrors();
  el('save-details').hidden = true;
  if (Object.keys(errors).length) {
    announce('form-message', copy.failed, true);
    focusError();
    return;
  }
  const original =
    editingId === null ? null : config.monitors.find((m) => m.id === editingId);
  if (editingId !== null && !original) {
    announce(
      'form-message',
      'This monitor no longer exists. Cancel and refresh before trying again.',
      true,
    );
    focusError();
    return;
  }
  const device = selectedDevice();
  const strategy =
    kind() === 'timestamp-capability'
      ? {
          kind: kind(),
          capabilities: selectedCapabilities(),
          encoding: el('encoding').value,
        }
      : { kind: kind() };
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
  const next = {
    ...config,
    monitors: original
      ? config.monitors.map((m) => (m.id === original.id ? monitor : m))
      : [...config.monitors, monitor],
  };
  announce('form-message', 'Saving…');
  try {
    const refreshed = await writeConfig(next, true);
    announce(
      'form-message',
      refreshed
        ? 'Monitor saved.'
        : 'Monitor saved. Status could not be refreshed; use Refresh status to try again.',
    );
  } catch (error) {
    saveError(error, next);
  }
}

function renderMonitors() {
  el('monitors-empty').hidden = !!config?.monitors.length;
  el('monitors').replaceChildren(
    ...(config?.monitors ?? []).map((monitor) => {
      const card = node('li', '', 'card');
      const runtime = latestStatus.monitors.find(
        (m) => m.id === monitor.id,
      )?.runtime;
      card.append(node('p', monitor.sourceAppName, 'monitor-source'));
      const heading = node('div', '', 'monitor-heading');
      heading.append(
        node('h3', monitor.deviceName),
        badge(monitor.enabled ? (runtime?.state ?? 'UNKNOWN') : 'DISABLED'),
      );
      card.append(heading);
      const summary = node('dl');
      rows(summary, [
        ['Method', copy.methods[monitor.strategy.kind]],
        [
          'Last delivery',
          runtime?.lastDeliveryAt == null
            ? 'Not confirmed yet'
            : date(runtime.lastDeliveryAt),
        ],
        ['Timeout', `${monitor.staleTimeoutMs / 60000} min`],
      ]);
      card.append(summary);
      const details = node('details');
      details.append(node('summary', 'Technical details'));
      const technical = node('dl');
      rows(technical, [
        ['Monitor ID', monitor.id],
        ['Source app ID', monitor.sourceAppId],
        ['Device ID', monitor.deviceId],
        ['Strategy', monitor.strategy.kind],
        [
          'Evidence kind',
          monitor.strategy.kind === 'device-last-seen'
            ? 'device-activity'
            : 'data-delivery',
        ],
        [
          'Timestamp fields',
          monitor.strategy.capabilities?.join(', ') || 'Not applicable',
        ],
        ['Exact last delivery', date(runtime?.lastDeliveryAt, true)],
        ['Technical note', monitor.sourceContract || 'None'],
      ]);
      details.append(technical);
      card.append(details);
      const actions = node('div', '', 'actions');
      const feedback = node('p');
      feedback.setAttribute('role', 'status');
      const edit = node('button', 'Edit');
      edit.type = 'button';
      edit.disabled = saving;
      edit.onclick = () => editMonitor(monitor);
      actions.append(edit);
      for (const [label, action] of [
        [monitor.enabled ? 'Disable' : 'Enable', 'toggle'],
        ['Remove', 'remove'],
      ]) {
        const button = node(
          'button',
          label,
          action === 'remove' ? 'danger' : '',
        );
        button.type = 'button';
        button.disabled = saving || editingId !== null;
        button.onclick = async () => {
          if (saving || editingId !== null) return;
          const next = {
            ...config,
            monitors:
              action === 'remove'
                ? config.monitors.filter((m) => m.id !== monitor.id)
                : config.monitors.map((m) =>
                    m.id === monitor.id ? { ...m, enabled: !m.enabled } : m,
                  ),
          };
          try {
            await writeConfig(next);
          } catch (error) {
            announce(
              'message',
              `Could not update ${monitor.deviceName}: ${errorText(error)}`,
              true,
            );
            el('message').scrollIntoView({ block: 'center' });
          }
        };
        actions.append(button);
      }
      card.append(actions, feedback);
      return card;
    }),
  );
}
function renderObserver(status) {
  const observers = {
    observing: 'Connected',
    starting: 'Starting',
    disconnected: 'Disconnected',
    unavailable: 'Unavailable',
    'persistence-error': 'Unable to save monitoring state',
  };
  const restores = {
    new: 'New session',
    restored: 'Restored',
    rejected: 'Previous state incompatible; observing again',
  };
  rows(el('observer-summary'), [
    ['Observer', observers[status.observer] ?? 'Unknown'],
    ['Dispatch failures', status.dispatchFailures ?? 0],
    ['Restore', restores[status.restore] ?? 'Unknown'],
  ]);
  el('metadata-warning').hidden = !status.metadataIncomplete;
  el('integration-status').replaceChildren(
    ...(status.integrations ?? []).map((source) => {
      const name =
        inventory.find((g) => g.sourceAppId === source.sourceAppId)
          ?.sourceAppName ??
        config.monitors.find((m) => m.sourceAppId === source.sourceAppId)
          ?.sourceAppName ??
        source.sourceAppId;
      const row = node('li');
      row.append(node('span', name), badge(source.state));
      return row;
    }),
  );
  if (!status.integrations?.length)
    el('integration-status').append(
      node('li', 'No monitored integrations yet.'),
    );
  el('status').textContent = JSON.stringify(status, null, 2);
}
function renderTestSource(source) {
  el('test-paired').hidden = !source.paired;
  el('test-unpaired').hidden = !!source.paired;
  el('test-badge').hidden = !source.paired;
  if (!source.paired) return;
  const state = source.running ? 'RUNNING' : 'STOPPED';
  el('test-badge').textContent = state;
  el('test-badge').setAttribute('data-state', state);
  rows(el('test-summary'), [
    ['Interval', `${source.intervalMs / 1000} s`],
    ['Last generated', date(source.lastGeneratedAt)],
  ]);
  rows(el('test-details'), [
    [
      'Native lastSeenAt',
      {
        'not-sent': 'Not sent',
        sent: 'Sent',
        failed: 'Failed',
        unavailable: 'Unavailable',
      }[source.nativeLastSeen] ?? 'Unknown',
    ],
    ['Manual deliveries', source.manualDeliveries ?? 0],
    ['Exact last generated', date(source.lastGeneratedAt, true)],
    ['Restart behavior', 'Stopped'],
  ]);
  el('test-start').disabled = source.running;
  el('test-stop').disabled = !source.running;
  el('test-send').disabled = false;
  announce('test-message', source.lastError ?? '', !!source.lastError);
}
async function loadTestSource() {
  try {
    renderTestSource(await api('GET', '/test-source', null));
  } catch (error) {
    announce(
      'test-message',
      `Could not refresh the local test source: ${errorText(error)}`,
      true,
    );
  }
}
async function load() {
  const [next, inventoryResult, status] = await Promise.all([
    api('GET', '/config', null),
    api('GET', '/inventory', null),
    api('GET', '/status', null),
  ]);
  config = next;
  inventory = inventoryResult;
  latestStatus = status;
  if (!initialized) {
    initialized = true;
    resetForm();
  }
  // Refresh updates status without discarding add/edit drafts or saved missing fields.
  if (editingId === null) {
    const sourceId = el('source').value;
    const deviceId = el('device').value;
    const selected = selectedCapabilities();
    sources();
    if (sourceId) {
      if (!inventory.some((g) => g.sourceAppId === sourceId))
        el('source').append(
          option(sourceId, `${sourceId} (not currently listed)`),
        );
      el('source').value = sourceId;
      devices();
    }
    if (deviceId) {
      if (
        !inventory
          .flatMap((g) => g.devices)
          .some((d) => d.deviceId === deviceId)
      )
        el('device').append(
          option(deviceId, `${deviceId} (not currently listed)`),
        );
      el('device').value = deviceId;
      capabilities(selected);
    }
  }
  renderMonitors();
  renderObserver(status);
  formMode();
  await loadTestSource();
}
function onHomeyReady(Homey) {
  homey = Homey;
  homey.ready();
  formMode();
  el('monitor-form').onsubmit = submit;
  el('source').onchange = () => {
    devices();
    correctErrors();
  };
  el('device').onchange = () => {
    capabilities();
    correctErrors();
  };
  for (const k of kinds)
    el(`strategy-${k}`).onchange = () => {
      timestampVisibility();
      correctErrors();
    };
  for (const id of ['encoding', 'expected', 'timeout', 'contract']) {
    el(id).oninput = correctErrors;
    el(id).onchange = correctErrors;
  }
  el('cancel').onclick = () => {
    if (saving) return;
    resetForm();
    renderMonitors();
    announce('form-message', 'Changes cancelled.');
  };
  el('refresh').onclick = async () => {
    if (saving) return;
    try {
      await load();
      announce('message', 'Status refreshed.');
    } catch (error) {
      announce(
        'message',
        `Could not refresh status: ${errorText(error)}`,
        true,
      );
    }
  };
  for (const action of ['start', 'stop', 'send'])
    el(`test-${action}`).onclick = async () => {
      for (const a of ['start', 'stop', 'send'])
        el(`test-${a}`).disabled = true;
      try {
        renderTestSource(await api('POST', '/test-source', { action }));
      } catch (error) {
        await loadTestSource();
        announce(
          'test-message',
          `Test heartbeat command failed: ${errorText(error)}`,
          true,
        );
      }
    };
  load().catch((error) => {
    announce(
      'message',
      `Could not load settings: ${errorText(error)}. Use Refresh status to retry.`,
      true,
    );
    el('refresh').disabled = false;
  });
}
window.onHomeyReady = onHomeyReady;
