let homey;
let config;
let inventory = [];
let editingId = null;
let saving = false;
let initialized = false;
let capabilityChoices = [];
let drafts = new Map();
let pickerSelection = new Set();
let monitorFilter = null;
let draftSequence = 0;
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
  el('cancel').hidden = !editing && !kind();
  el('edit-fields').hidden = !editing;
  el('setup-fields').hidden = editing;
  el('select-devices').disabled = saving || !config || !kind();
  if (!editing)
    el('add').textContent = saving
      ? 'Saving…'
      : `Add ${drafts.size || ''}${drafts.size ? ' ' : ''}monitor${drafts.size === 1 || !drafts.size ? '' : 's'}`;
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
  drafts = new Map();
  closePicker();
  setKind(undefined);
  renderSetup();
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
  closePicker();
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
  return {
    ...issues,
    ...validateValues({
      kind: kind(),
      capabilities: selectedCapabilities(),
      encoding: el('encoding').value,
      expected: el('expected').value,
      timeout: el('timeout').value,
      contract: el('contract').value,
    }),
  };
}
function validateValues(values) {
  const issues = {};
  if (!values.kind) issues.strategy = 'Choose how freshness should be checked.';
  if (values.kind === 'timestamp-capability') {
    if (!values.capabilities.length)
      issues.capabilities = copy.selectCapability;
    else if (values.capabilities.length > 16)
      issues.capabilities = 'Select no more than 16 timestamp fields.';
    if (!['iso', 'epoch-seconds', 'epoch-ms'].includes(values.encoding))
      issues.encoding = 'Select the timestamp format used by the source.';
  }
  for (const field of ['expected', 'timeout']) {
    const milliseconds = Number(values[field]) * 60000;
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
    Number(values.timeout) < Number(values.expected)
  )
    issues.timeout = copy.timingOrder;
  if (!issues.timeout && values.kind !== 'manual' && Number(values.timeout) < 2)
    issues.timeout = copy.observedMinimum;
  if (values.contract.length > 2000)
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
  if (editingId === null) return submitSetup();
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

// Setup groups and selections are ephemeral. Only ordinary monitor records are saved.
function inventoryDevices() {
  return inventory.flatMap((group) => group.devices);
}
function closePicker() {
  el('device-picker').hidden = true;
  el('select-devices').setAttribute('aria-expanded', 'false');
}
function openPicker() {
  if (saving || !config || !kind()) return;
  pickerSelection = new Set(drafts.keys());
  renderPicker();
  el('device-picker').hidden = false;
  el('select-devices').setAttribute('aria-expanded', 'true');
  el('confirm-devices').focus();
}
function renderPicker() {
  const groups = inventory
    .map((group) => {
      const section = node('fieldset', '', 'field');
      section.append(node('legend', group.sourceAppName));
      for (const device of group.devices) {
        const label = node('label', '', 'choice');
        const input = node('input');
        input.type = 'checkbox';
        input.value = device.deviceId;
        input.checked = pickerSelection.has(device.deviceId);
        input.disabled = config.monitors.some(
          (m) => m.deviceId === device.deviceId,
        );
        input.onchange = () => {
          if (input.checked) pickerSelection.add(device.deviceId);
          else pickerSelection.delete(device.deviceId);
        };
        label.append(
          input,
          node(
            'span',
            `${device.deviceName}${device.zone ? ` · ${device.zone}` : ''}${input.disabled ? ' (already monitored)' : ''}`,
          ),
        );
        section.append(label);
      }
      return section;
    })
    .filter((section) => section.children.length > 1);
  el('picker-options').replaceChildren(...groups);
  if (!groups.length)
    el('picker-options').append(
      node(
        'p',
        'No devices are currently listed. Refresh the inventory to try again.',
      ),
    );
  // Retain a way to deselect a source that disappeared while setup was open.
  for (const [id, draft] of drafts) {
    if (inventoryDevices().some((d) => d.deviceId === id)) continue;
    const label = node('label', '', 'choice');
    const input = node('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = pickerSelection.has(id);
    input.onchange = () =>
      input.checked ? pickerSelection.add(id) : pickerSelection.delete(id);
    label.append(
      input,
      node('span', `${draft.device.deviceName} (not currently listed)`),
    );
    el('picker-options').append(label);
  }
}
function confirmDevices() {
  if (saving) return;
  for (const id of drafts.keys())
    if (!pickerSelection.has(id)) drafts.delete(id);
  for (const device of inventoryDevices()) {
    if (
      pickerSelection.has(device.deviceId) &&
      !drafts.has(device.deviceId) &&
      !config.monitors.some((m) => m.deviceId === device.deviceId)
    )
      drafts.set(device.deviceId, createDraft(device));
  }
  closePicker();
  renderSetup();
  formMode();
  el('select-devices').focus();
}
function createDraft(device) {
  const draft = {
    device,
    controls: {},
    errors: {},
    messages: {},
    capabilityInputs: [],
    card: node('fieldset', '', 'card'),
  };
  const prefix = `setup-${++draftSequence}`;
  draft.card.setAttribute('data-device-id', device.deviceId);
  draft.card.append(
    node('legend', device.deviceName),
    node(
      'p',
      `${device.sourceAppName}${device.zone ? ` · ${device.zone}` : ''}`,
      'monitor-source',
    ),
  );
  function field(key, title, tag, value, type) {
    const wrapper = node('div', '', 'field');
    const input = node(tag);
    input.id = `${prefix}-${key}`;
    if (type) input.type = type;
    input.value = value;
    if (type === 'number') {
      input.setAttribute('step', '0.5');
      input.setAttribute('inputmode', 'decimal');
    }
    if (tag === 'textarea') input.setAttribute('maxlength', '2000');
    const label = node('label', title);
    label.setAttribute('for', input.id);
    const message = node('p', '', 'field-error');
    message.id = `${input.id}-error`;
    message.hidden = true;
    input.setAttribute('aria-describedby', message.id);
    input.oninput = input.onchange = () => correctDraftErrors(draft);
    wrapper.append(label, input, message);
    draft.controls[key] = input;
    draft.messages[key] = message;
    return wrapper;
  }
  draft.timestamp = node('div');
  draft.timestamp.id = `${prefix}-timestamp-fields`;
  const choices = node('fieldset', '', 'field');
  choices.id = `${prefix}-capabilities`;
  choices.setAttribute('tabindex', '-1');
  choices.append(
    node('legend', 'Which field contains the delivery timestamp?'),
    node('small', el('capabilities-help').textContent),
  );
  const compatible = device.capabilities.filter(
    (c) => !c.type || ['string', 'number', 'unknown'].includes(c.type),
  );
  for (const capability of compatible) {
    const label = node('label', '', 'choice');
    const input = node('input');
    input.type = 'checkbox';
    input.value = capability.id;
    input.checked = compatible.length === 1;
    input.setAttribute('aria-describedby', `${choices.id}-error`);
    input.onchange = () => correctDraftErrors(draft);
    const description = node('span');
    description.append(
      node('strong', capability.title),
      node('small', capability.id, 'capability-id'),
    );
    label.append(input, description);
    choices.append(label);
    draft.capabilityInputs.push(input);
  }
  if (!compatible.length)
    choices.append(
      node(
        'small',
        'No timestamp-compatible fields are currently listed for this device.',
      ),
    );
  const message = node('p', '', 'field-error');
  message.id = `${choices.id}-error`;
  message.hidden = true;
  choices.append(message);
  draft.messages.capabilities = message;
  draft.controls.capabilities = choices;
  const encoding = field('encoding', 'Timestamp format', 'select', 'iso');
  draft.controls.encoding.append(
    option('iso', 'Date and time (ISO, with timezone)'),
    option('epoch-seconds', 'Unix time in seconds'),
    option('epoch-ms', 'Unix time in milliseconds'),
  );
  encoding.append(node('small', el('encoding-help').textContent));
  draft.timestamp.append(choices, encoding);
  draft.card.append(draft.timestamp);
  const timing = node('div', '', 'timing-grid');
  timing.append(
    field(
      'expected',
      'Expected update interval (minutes)',
      'input',
      '5',
      'number',
    ),
    field('timeout', 'Consider stale after (minutes)', 'input', '15', 'number'),
  );
  draft.card.append(timing, node('small', el('timeout-help').textContent));
  draft.advanced = node('details');
  draft.advanced.append(
    node('summary', 'Advanced (optional)'),
    field('contract', 'Technical note (optional)', 'textarea', ''),
  );
  draft.card.append(draft.advanced);
  const enabled = node('label', '', 'enabled');
  draft.controls.enabled = node('input');
  draft.controls.enabled.type = 'checkbox';
  draft.controls.enabled.checked = true;
  enabled.append(draft.controls.enabled, node('span', ' Monitor enabled'));
  draft.card.append(enabled);
  return draft;
}
function draftValues(draft) {
  return {
    kind: kind(),
    capabilities: draft.capabilityInputs
      .filter((i) => i.checked)
      .map((i) => i.value),
    ...Object.fromEntries(
      ['encoding', 'expected', 'timeout', 'contract'].map((key) => [
        key,
        draft.controls[key].value,
      ]),
    ),
  };
}
function renderDraftErrors(draft) {
  for (const [key, message] of Object.entries(draft.messages)) {
    message.textContent = draft.errors[key] ?? '';
    message.hidden = !draft.errors[key];
    draft.controls[key].setAttribute(
      'aria-invalid',
      draft.errors[key] ? 'true' : 'false',
    );
  }
}
function correctDraftErrors(draft) {
  const corrected = validateValues(draftValues(draft));
  for (const key of Object.keys(draft.errors)) {
    if (corrected[key]) draft.errors[key] = corrected[key];
    else delete draft.errors[key];
  }
  renderDraftErrors(draft);
}
function renderSetup() {
  el('selection-summary').textContent = !kind()
    ? 'Choose a monitoring method first.'
    : `${drafts.size} device${drafts.size === 1 ? '' : 's'} selected`;
  el('selection-error').hidden = true;
  el('setup-timing').hidden = drafts.size === 0;
  for (const draft of drafts.values()) {
    draft.timestamp.hidden = kind() !== 'timestamp-capability';
    correctDraftErrors(draft);
  }
  el('selected-devices').replaceChildren(
    ...[...drafts.values()].map((d) => d.card),
  );
  const groups = new Map();
  for (const device of inventoryDevices()) {
    const draft = drafts.get(device.deviceId);
    if (
      !draft ||
      !device.identityResolved ||
      !device.driverId ||
      device.sourceAppId !== draft.device.sourceAppId
    )
      continue;
    const key = JSON.stringify([device.sourceAppId, device.driverId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(draft);
  }
  el('similar-devices').replaceChildren(
    ...[...groups.values()]
      .filter((group) => group.length > 1)
      .map((group) => {
        const section = node('div', '', 'timing-shortcut');
        const first = group[0];
        section.append(
          node(
            'strong',
            `${group.length} similar devices selected · ${first.device.sourceAppName}`,
          ),
          node(
            'p',
            `Same app and driver. Set the times for ${first.device.deviceName} below, then copy them to this selection. Each device stays individually adjustable.`,
          ),
        );
        const button = node(
          'button',
          `Apply ${first.device.deviceName}'s times to all ${group.length}`,
        );
        button.type = 'button';
        const feedback = node('p');
        feedback.setAttribute('role', 'status');
        button.onclick = () => {
          if (saving) return;
          for (const draft of group) {
            for (const key of ['expected', 'timeout'])
              draft.controls[key].value = first.controls[key].value;
            correctDraftErrors(draft);
          }
          feedback.textContent = `Times applied to ${group.length} devices. You can still adjust each device below.`;
        };
        section.append(button, feedback);
        return section;
      }),
  );
}
async function submitSetup() {
  errors = kind()
    ? {}
    : { strategy: 'Choose how freshness should be checked.' };
  renderErrors();
  el('save-details').hidden = true;
  let selectionError = drafts.size ? '' : 'Select a device before saving.';
  if (!el('device-picker').hidden)
    selectionError = 'Confirm or cancel the device selection before saving.';
  if (config.monitors.length + drafts.size > 500)
    selectionError = 'You can configure up to 500 monitors.';
  let firstInvalid;
  for (const [id, draft] of drafts) {
    const device = inventoryDevices().find(
      (d) => d.deviceId === id && d.sourceAppId === draft.device.sourceAppId,
    );
    if (!device)
      selectionError = `${draft.device.deviceName} is no longer in the inventory. Deselect it or refresh before saving.`;
    if (config.monitors.some((m) => m.deviceId === id || m.id === id))
      selectionError = `${draft.device.deviceName} already has a monitor. Deselect it and use Edit.`;
    draft.errors = validateValues(draftValues(draft));
    renderDraftErrors(draft);
    if (!firstInvalid && Object.keys(draft.errors).length) firstInvalid = draft;
  }
  el('selection-error').textContent = selectionError;
  el('selection-error').hidden = !selectionError;
  if (Object.keys(errors).length || selectionError || firstInvalid) {
    announce('form-message', copy.failed, true);
    if (errors.strategy) focusError();
    else if (selectionError) el('select-devices').focus();
    else {
      const key = fields.find((key) => firstInvalid.errors[key]);
      if (key === 'contract') firstInvalid.advanced.open = true;
      const target =
        key === 'capabilities'
          ? (firstInvalid.capabilityInputs[0] ??
            firstInvalid.controls.capabilities)
          : firstInvalid.controls[key];
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      target.focus({ preventScroll: true });
    }
    return;
  }
  const monitors = [...drafts.values()].map((draft) => {
    const device = inventoryDevices().find(
      (d) => d.deviceId === draft.device.deviceId,
    );
    const values = draftValues(draft);
    return {
      id: device.deviceId,
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      sourceAppId: device.sourceAppId,
      sourceAppName: device.sourceAppName,
      zone: device.zone,
      strategy:
        values.kind === 'timestamp-capability'
          ? {
              kind: values.kind,
              capabilities: values.capabilities,
              encoding: values.encoding,
            }
          : { kind: values.kind },
      expectedIntervalMs: Number(values.expected) * 60000,
      staleTimeoutMs: Number(values.timeout) * 60000,
      sourceContract: values.contract,
      enabled: draft.controls.enabled.checked,
    };
  });
  try {
    const refreshed = await writeConfig(
      { ...config, monitors: [...config.monitors, ...monitors] },
      true,
    );
    announce(
      'form-message',
      `${monitors.length === 1 ? 'Monitor saved.' : `${monitors.length} monitors saved.`}${refreshed ? '' : ' Status could not be refreshed; use Refresh status to try again.'}`,
    );
  } catch (error) {
    announce('form-message', copy.retry, true);
    el('save-error-detail').textContent = errorText(error);
    el('save-details').hidden = false;
    el('form-message').focus();
  }
}
function renderMonitorSummary() {
  const monitors = config?.monitors ?? [];
  if (!monitors.some((m) => m.strategy.kind === monitorFilter))
    monitorFilter = null;
  el('monitor-summary').hidden = monitors.length === 0;
  el('monitor-summary').replaceChildren(
    ...[null, ...kinds].map((method) => {
      const count = method
        ? monitors.filter((m) => m.strategy.kind === method).length
        : monitors.length;
      const button = node(
        'button',
        `${method ? copy.methods[method] : 'All'} · ${count}`,
      );
      button.type = 'button';
      button.setAttribute('aria-pressed', String(monitorFilter === method));
      button.disabled = count === 0;
      button.onclick = () => {
        monitorFilter = method;
        renderMonitors();
      };
      return button;
    }),
  );
}
function renderMonitors() {
  renderMonitorSummary();
  el('monitors-empty').hidden = !!config?.monitors.length;
  el('monitors').replaceChildren(
    ...(config?.monitors ?? [])
      .filter((m) => !monitorFilter || m.strategy.kind === monitorFilter)
      .map((monitor) => {
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
  // Keep individual setup inputs and edit drafts intact across status refreshes.
  if (editingId === null) {
    renderSetup();
    if (!el('device-picker').hidden) renderPicker();
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
      if (editingId === null) {
        errors = {};
        renderErrors();
        renderSetup();
        formMode();
      } else correctErrors();
    };
  el('select-devices').onclick = openPicker;
  el('cancel-devices').onclick = () => {
    closePicker();
    el('select-devices').focus();
  };
  el('confirm-devices').onclick = confirmDevices;
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
