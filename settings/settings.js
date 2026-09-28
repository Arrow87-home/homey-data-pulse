let homey;
let config;
let inventory = [];
let editingId = null;
let formOpen = false;
let saving = false;
let initialized = false;
let capabilityChoices = [];
let drafts = new Map();
let pickerSelection = new Set();
let monitorFilter = null;
let draftSequence = 0;
let errors = {};
let sharedErrors = {};
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
// Homey's standard locale lookup keeps setup copy in /locales, including errors.
const t = (key, tokens) => homey.__(`settings.${key}`, tokens);
let copy;
function localizeSetup() {
  copy = Object.fromEntries(
    [
      'selectSource',
      'selectDevice',
      'selectCapability',
      'timingOrder',
      'observedMinimum',
      'invalidTiming',
      'failed',
      'retry',
    ].map((key) => [key, t(key)]),
  );
  copy.methods = Object.fromEntries(
    kinds.map((key) => [key, t(`methods.${key}`)]),
  );
  for (const element of document.querySelectorAll('[data-i18n]'))
    element.textContent = homey.__(element.getAttribute('data-i18n'));
}
const el = (id) => document.getElementById(id);
const api = (method, path, body) =>
  new Promise((resolve, reject) =>
    homey.api(method, path, body, (err, value) =>
      err ? reject(err) : resolve(value),
    ),
  );
const errorText = (error) =>
  typeof error === 'string' ? error : (error?.message ?? t('unexpected'));
function announce(id, text, error = false) {
  el(id).textContent = text;
  el(id).className = error ? 'action-message error' : 'action-message';
  if (id === 'form-message' && el('monitor-setup').hidden && text)
    announce('message', text, error);
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
    option('', t('chooseSource')),
    ...inventory.map((g) => option(g.sourceAppId, g.sourceAppName)),
  );
  if (inventory.length === 1) el('source').value = inventory[0].sourceAppId;
  devices();
}
function devices() {
  const group = inventory.find((g) => g.sourceAppId === el('source').value);
  el('device').replaceChildren(
    option('', t('chooseDevice')),
    ...(group?.devices ?? []).map((d) => option(d.deviceId, d.deviceName)),
  );
  if (group?.devices.length === 1)
    el('device').value = group.devices[0].deviceId;
  capabilities();
}
function timestampDescription(capability) {
  const description = node('span');
  description.append(node('strong', capability.title));
  if (capability.timestampCandidate) {
    const time = new Date(capability.timestampCandidate.at).toLocaleString(
      t('dateLocale'),
      {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
    description.append(node('small', t('timestampPreview', { time })));
  }
  description.append(node('small', capability.id, 'capability-id'));
  if (capability.warning)
    description.append(node('small', t(capability.warning)));
  return description;
}
function capabilities(saved, savedEncoding) {
  const all = selectedDevice()?.capabilities ?? [];
  const available = all.filter((c) => c.timestampCandidate);
  const choices = available.map((c) => ({ ...c }));
  for (const id of saved ?? []) {
    let capability = choices.find((c) => c.id === id);
    if (!capability) {
      const existing = all.find((c) => c.id === id);
      capability = {
        ...existing,
        id,
        title: existing?.title ?? id,
        warning: existing ? 'unverifiedSavedField' : 'missingField',
      };
      choices.push(capability);
    } else if (capability.timestampCandidate.encoding !== savedEncoding) {
      capability.warning = 'savedFormatMismatch';
    }
  }
  const selected = saved ?? (available.length === 1 ? [available[0].id] : []);
  if (!saved && available.length === 1)
    el('encoding').value = available[0].timestampCandidate.encoding;
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
      label.append(input, timestampDescription(capability));
      capabilityChoices.push(input);
      return label;
    }),
  );
  el('capabilities-empty').hidden = available.length !== 0;
}
function formMode() {
  const editing = editingId !== null;
  const picking = !el('device-picker').hidden;
  el('monitor-setup').hidden = !formOpen;
  el('add-monitor').disabled = saving || !config || editing;
  el('add-monitor').setAttribute('aria-expanded', String(formOpen));
  el('close-setup').hidden = editing || picking;
  el('close-setup').disabled = saving;
  el('form-title').textContent = t(editing ? 'editMonitor' : 'newMonitors');
  el('add').textContent = t(
    saving ? 'saving' : editing ? 'saveChanges' : 'addMonitors',
  );
  el('cancel').hidden = !editing;
  el('edit-fields').hidden = !editing;
  el('setup-fields').hidden = editing;
  el('select-devices').disabled = saving || !config || !kind();
  el('select-devices').textContent = t(
    drafts.size ? 'changeSelection' : 'selectDevices',
  );
  el('source').disabled = el('device').disabled = editing;
  el('draft-fields').disabled = saving;
  el('form-actions').hidden = picking;
  el('selection-controls').hidden = picking;
  el('setup-timing').hidden = !drafts.size || picking;
  el('add').disabled =
    el('cancel').disabled =
    el('refresh').disabled =
      saving || !config;
}

function resetForm() {
  formOpen = false;
  editingId = null;
  errors = {};
  renderErrors();
  el('save-details').hidden = true;
  el('advanced').open = false;
  el('enabled').checked = true;
  drafts = new Map();
  sharedErrors = {};
  renderSharedErrors();
  el('setup-expected').value = '5';
  el('setup-timeout').value = '15';
  el('device-settings').open = false;
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
  formOpen = true;
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
    monitor.strategy.encoding,
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
    issues.device = t('duplicate');
  return {
    ...issues,
    ...validateValues({
      kind: kind(),
      deviceCapabilities: selectedDevice()?.capabilities ?? [],
      savedStrategy: config?.monitors.find((m) => m.id === editingId)?.strategy,
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
  if (!values.kind) issues.strategy = t('chooseMethod');
  if (values.kind === 'timestamp-capability') {
    if (!values.capabilities.length)
      issues.capabilities = copy.selectCapability;
    else if (values.capabilities.length > 16)
      issues.capabilities = t('maxFields');
    if (!['iso', 'epoch-seconds', 'epoch-ms'].includes(values.encoding))
      issues.encoding = t('chooseEncoding');
    else if (
      values.capabilities.some((id) => {
        // Keep existing selections editable even if the current value is missing/invalid.
        if (
          values.savedStrategy?.kind === 'timestamp-capability' &&
          values.savedStrategy.encoding === values.encoding &&
          values.savedStrategy.capabilities.includes(id)
        )
          return false;
        return (
          values.deviceCapabilities?.find((c) => c.id === id)
            ?.timestampCandidate?.encoding !== values.encoding
        );
      })
    )
      issues.encoding = t('fieldFormatMismatch');
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
  if (values.contract.length > 2000) issues.contract = t('noteLimit');
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
          contract: t('optionalNoteLimit'),
          source: copy.selectSource,
          device: copy.selectDevice,
          strategy: t('supportedMethod'),
          encoding: t('supportedEncoding'),
        }[field];
    }
  if (raw.includes('120000')) errors.timeout = copy.observedMinimum;
  if (/Duplicate (deviceId|id)/.test(raw))
    errors.device = t('duplicateRefresh');
  if (/identity mismatch/.test(raw)) errors.device = t('identityChanged');
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
    if (reset) {
      resetForm();
      el('add-monitor').focus();
    }
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
    announce('form-message', t('monitorMissing'), true);
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
  announce('form-message', t('saving'));
  try {
    const refreshed = await writeConfig(next, true);
    announce('form-message', refreshed ? t('saved') : t('savedRefreshFailed'));
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
  formMode();
}
function openPicker() {
  if (saving || !config || !kind()) return;
  pickerSelection = new Set(drafts.keys());
  renderPicker();
  el('device-picker').hidden = false;
  el('select-devices').setAttribute('aria-expanded', 'true');
  formMode();
  const first = el('picker-options').querySelector('input:not(:disabled)');
  (first ?? el('confirm-devices')).focus();
}
function renderPicker() {
  const groups = inventory
    .map((group) => {
      const section = node('div', '', 'picker-group');
      section.append(node('h4', group.sourceAppName));
      for (const device of group.devices) {
        const label = node('label', '', 'selection-tile');
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
        const description = node('span');
        description.append(
          node('strong', device.deviceName),
          node('small', input.disabled ? t('alreadyMonitored') : device.zone),
        );
        label.append(input, description);
        section.append(label);
      }
      return section;
    })
    .filter((section) => section.children.length > 1);
  el('picker-options').replaceChildren(...groups);
  if (!groups.length)
    el('picker-options').append(node('p', t('emptyInventory')));
  // Retain a way to deselect a source that disappeared while setup was open.
  for (const [id, draft] of drafts) {
    if (inventoryDevices().some((d) => d.deviceId === id)) continue;
    const label = node('label', '', 'selection-tile');
    const input = node('input');
    input.type = 'checkbox';
    input.value = id;
    input.checked = pickerSelection.has(id);
    input.onchange = () =>
      input.checked ? pickerSelection.add(id) : pickerSelection.delete(id);
    label.append(
      input,
      node('span', t('missingSelection', { name: draft.device.deviceName })),
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
    override: false,
    card: node('div', '', 'device-options'),
  };
  const prefix = `setup-${++draftSequence}`;
  draft.card.setAttribute('data-device-id', device.deviceId);
  draft.card.append(
    node('h4', device.deviceName),
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
    node('legend', t('timestampField')),
    node('small', el('capabilities-help').textContent),
  );
  const compatible = device.capabilities.filter((c) => c.timestampCandidate);
  for (const capability of compatible) {
    const label = node('label', '', 'choice');
    const input = node('input');
    input.type = 'checkbox';
    input.value = capability.id;
    input.checked = compatible.length === 1;
    input.setAttribute('aria-describedby', `${choices.id}-error`);
    input.onchange = () => correctDraftErrors(draft);
    label.append(input, timestampDescription(capability));
    choices.append(label);
    draft.capabilityInputs.push(input);
  }
  if (!compatible.length) choices.append(node('small', t('noTimestampFields')));
  const message = node('p', '', 'field-error');
  message.id = `${choices.id}-error`;
  message.hidden = true;
  choices.append(message);
  draft.messages.capabilities = message;
  draft.controls.capabilities = choices;
  const encoding = field('encoding', t('encoding'), 'select', 'iso');
  draft.controls.encoding.append(
    option('iso', t('iso')),
    option('epoch-seconds', t('seconds')),
    option('epoch-ms', t('milliseconds')),
  );
  if (compatible.length === 1)
    draft.controls.encoding.value = compatible[0].timestampCandidate.encoding;
  encoding.append(node('small', el('encoding-help').textContent));
  draft.timestamp.append(choices, encoding);
  draft.card.append(draft.timestamp);
  const timing = node('div', '', 'timing-grid');
  draft.timing = timing;
  timing.hidden = true;
  draft.overrideButton = node('button', t('customTiming'));
  draft.overrideButton.type = 'button';
  draft.overrideButton.id = `${prefix}-override`;
  draft.overrideButton.setAttribute('aria-pressed', 'false');
  draft.overrideButton.onclick = () => {
    if (saving) return;
    if (!draft.override)
      for (const key of ['expected', 'timeout'])
        draft.controls[key].value = el(`setup-${key}`).value;
    draft.override = !draft.override;
    syncDraftTiming(draft);
    correctDraftErrors(draft);
    correctSharedErrors();
  };
  draft.card.append(draft.overrideButton);
  timing.append(
    field('expected', t('expectedMinutes'), 'input', '5', 'number'),
    field('timeout', t('timeoutMinutes'), 'input', '15', 'number'),
  );
  draft.card.append(timing);
  draft.advanced = node('details');
  draft.advanced.append(
    node('summary', t('advanced')),
    field('contract', t('note'), 'textarea', ''),
  );
  draft.card.append(draft.advanced);
  const enabled = node('label', '', 'enabled');
  draft.controls.enabled = node('input');
  draft.controls.enabled.type = 'checkbox';
  draft.controls.enabled.checked = true;
  enabled.append(draft.controls.enabled, node('span', t('enabled')));
  draft.advanced.append(enabled);
  syncDraftTiming(draft);
  return draft;
}
function draftValues(draft) {
  return {
    deviceCapabilities: draft.device.capabilities,
    kind: kind(),
    capabilities: draft.capabilityInputs
      .filter((i) => i.checked)
      .map((i) => i.value),
    ...Object.fromEntries(
      ['encoding', 'contract'].map((key) => [key, draft.controls[key].value]),
    ),
    expected: draft.override
      ? draft.controls.expected.value
      : el('setup-expected').value,
    timeout: draft.override
      ? draft.controls.timeout.value
      : el('setup-timeout').value,
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
function syncDraftTiming(draft) {
  draft.timing.hidden = !draft.override;
  draft.overrideButton.textContent = t(
    draft.override ? 'useSharedTiming' : 'customTiming',
  );
  draft.overrideButton.setAttribute('aria-pressed', String(draft.override));
  for (const key of ['expected', 'timeout']) {
    if (!draft.override) draft.controls[key].value = el(`setup-${key}`).value;
    draft.controls[key].disabled = !draft.override;
  }
}
function renderSharedErrors() {
  for (const key of ['expected', 'timeout']) {
    el(`setup-${key}-error`).textContent = sharedErrors[key] ?? '';
    el(`setup-${key}-error`).hidden = !sharedErrors[key];
    el(`setup-${key}`).setAttribute(
      'aria-invalid',
      String(!!sharedErrors[key]),
    );
  }
}
function correctSharedErrors() {
  const inherited = [...drafts.values()].find((d) => !d.override);
  const corrected = inherited ? validateValues(draftValues(inherited)) : {};
  for (const key of Object.keys(sharedErrors)) {
    if (corrected[key]) sharedErrors[key] = corrected[key];
    else delete sharedErrors[key];
  }
  renderSharedErrors();
}
function renderSetup() {
  el('selection-summary').textContent = !kind()
    ? t('chooseMethodFirst')
    : drafts.size
      ? t('selectionSummary', {
          count: drafts.size,
          names: [...drafts.values()]
            .map((d) => d.device.deviceName)
            .join(', '),
        })
      : t('noSelection');
  el('selection-error').hidden = true;
  el('setup-timing').hidden = drafts.size === 0;
  el('timestamp-setup-hint').hidden = kind() !== 'timestamp-capability';
  el('timestamp-setup-hint').textContent = [
    t('timestampHint'),
    ...[...drafts.values()]
      .filter((d) => !d.device.capabilities.some((c) => c.timestampCandidate))
      .map((d) => `${d.device.deviceName}: ${t('noTimestampFields')}`),
  ].join(' ');
  for (const draft of drafts.values()) {
    draft.timestamp.hidden = kind() !== 'timestamp-capability';
    syncDraftTiming(draft);
    correctDraftErrors(draft);
  }
  correctSharedErrors();
  el('selected-devices').replaceChildren(
    ...[...drafts.values()].map((d) => d.card),
  );
}
async function submitSetup() {
  errors = kind() ? {} : { strategy: t('chooseMethod') };
  renderErrors();
  el('save-details').hidden = true;
  let selectionError = drafts.size ? '' : t('selectBeforeSaving');
  if (!el('device-picker').hidden) selectionError = t('confirmBeforeSaving');
  if (config.monitors.length + drafts.size > 500)
    selectionError = t('maxMonitors');
  let firstInvalid;
  sharedErrors = {};
  for (const [id, draft] of drafts) {
    const device = inventoryDevices().find(
      (d) => d.deviceId === id && d.sourceAppId === draft.device.sourceAppId,
    );
    if (!device)
      selectionError = t('missingDevice', { name: draft.device.deviceName });
    if (config.monitors.some((m) => m.deviceId === id || m.id === id))
      selectionError = t('alreadyHasMonitor', {
        name: draft.device.deviceName,
      });
    draft.errors = validateValues(draftValues(draft));
    if (!draft.override)
      for (const key of ['expected', 'timeout']) {
        if (draft.errors[key]) sharedErrors[key] = draft.errors[key];
        delete draft.errors[key];
      }
    renderDraftErrors(draft);
    if (!firstInvalid && Object.keys(draft.errors).length) firstInvalid = draft;
  }
  el('selection-error').textContent = selectionError;
  el('selection-error').hidden = !selectionError;
  renderSharedErrors();
  if (
    Object.keys(errors).length ||
    selectionError ||
    firstInvalid ||
    Object.keys(sharedErrors).length
  ) {
    announce('form-message', copy.failed, true);
    if (errors.strategy) focusError();
    else if (selectionError)
      (el('device-picker').hidden
        ? el('select-devices')
        : el('confirm-devices')
      ).focus();
    else if (Object.keys(sharedErrors).length) {
      const target = el(`setup-${Object.keys(sharedErrors)[0]}`);
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      target.focus();
    } else {
      el('device-settings').open = true;
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
      `${monitors.length === 1 ? t('saved') : t('batchSaved', { count: monitors.length })}${refreshed ? '' : t('refreshSuffix')}`,
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
        `${method ? copy.methods[method] : t('all')} · ${count}`,
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
        const card = node('li', '', 'card monitor-card');
        const runtime = latestStatus.monitors.find(
          (m) => m.id === monitor.id,
        )?.runtime;
        const heading = node('div', '', 'monitor-heading');
        heading.append(
          node('h3', monitor.deviceName),
          badge(monitor.enabled ? (runtime?.state ?? 'UNKNOWN') : 'DISABLED'),
        );
        card.append(heading);
        card.append(
          node(
            'p',
            t('monitorMeta', {
              source: monitor.sourceAppName,
              method: copy.methods[monitor.strategy.kind],
              minutes: monitor.staleTimeoutMs / 60000,
            }),
            'monitor-meta',
          ),
          node(
            'p',
            t('lastUpdate', {
              time:
                runtime?.lastDeliveryAt == null
                  ? t('notConfirmed')
                  : date(runtime.lastDeliveryAt),
            }),
            'monitor-last',
          ),
        );
        const details = node('details');
        details.append(node('summary', t('details')));
        const technical = node('dl');
        rows(technical, [
          [t('monitorId'), monitor.id],
          [t('appId'), monitor.sourceAppId],
          [t('deviceId'), monitor.deviceId],
          [t('strategy'), monitor.strategy.kind],
          [
            t('evidenceKind'),
            monitor.strategy.kind === 'device-last-seen'
              ? 'device-activity'
              : 'data-delivery',
          ],
          [
            t('timestampFields'),
            monitor.strategy.capabilities?.join(', ') || t('notApplicable'),
          ],
          [t('exactLast'), date(runtime?.lastDeliveryAt, true)],
          [t('technicalNote'), monitor.sourceContract || t('none')],
        ]);
        details.append(technical);
        card.append(details);
        const actions = node('div', '', 'actions monitor-actions');
        const edit = node('button', t('edit'));
        edit.type = 'button';
        edit.disabled = saving;
        edit.onclick = () => editMonitor(monitor);
        actions.append(edit);
        for (const [label, action] of [
          [monitor.enabled ? t('disable') : t('enable'), 'toggle'],
          [t('remove'), 'remove'],
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
                t('updateFailed', {
                  name: monitor.deviceName,
                  error: errorText(error),
                }),
                true,
              );
              el('message').scrollIntoView({ block: 'center' });
            }
          };
          actions.append(button);
        }
        card.append(actions);
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
  localizeSetup();
  homey.ready();
  el('monitor-summary').setAttribute('aria-label', t('filterMethods'));
  formMode();
  el('add-monitor').onclick = () => {
    if (saving || !config || editingId !== null) return;
    formOpen = true;
    formMode();
    el('form-title').scrollIntoView({ block: 'start', behavior: 'auto' });
    el(`strategy-${kind() ?? 'device-last-seen'}`).focus();
  };
  el('close-setup').onclick = () => {
    if (saving) return;
    resetForm();
    announce('form-message', '');
    el('add-monitor').focus();
  };
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
  for (const key of ['expected', 'timeout'])
    el(`setup-${key}`).oninput = () => {
      for (const draft of drafts.values()) {
        syncDraftTiming(draft);
        correctDraftErrors(draft);
      }
      correctSharedErrors();
    };
  for (const id of ['encoding', 'expected', 'timeout', 'contract']) {
    el(id).oninput = correctErrors;
    el(id).onchange = correctErrors;
  }
  el('cancel').onclick = () => {
    if (saving) return;
    resetForm();
    renderMonitors();
    announce('form-message', t('cancelled'));
    el('add-monitor').focus();
  };
  el('refresh').onclick = async () => {
    if (saving) return;
    try {
      await load();
      announce('message', t('refreshed'));
    } catch (error) {
      announce(
        'message',
        t('refreshFailed', { error: errorText(error) }),
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
    announce('message', t('loadFailed', { error: errorText(error) }), true);
    el('refresh').disabled = false;
  });
}
window.onHomeyReady = onHomeyReady;
