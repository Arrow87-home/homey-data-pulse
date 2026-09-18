import {
  Clock,
  configSchema,
  detectionFingerprint,
  DeviceIncident,
  IntegrationIncident,
  MonitorConfig,
  monitorFingerprint,
  MonitorRuntime,
  Snapshot,
  snapshotSchema,
  WatchdogConfig,
  WatchdogEvent,
} from './model';

/** Pure domain engine. No Homey objects, network access, timers or implicit clock. */
export class WatchdogEngine {
  readonly config: WatchdogConfig;
  private runtimes = new Map<string, MonitorRuntime>();
  private deviceIncidents = new Map<string, DeviceIncident>();
  private integrationIncidents = new Map<string, IntegrationIncident>();
  private monitors = new Map<string, MonitorConfig>();
  private groups = new Map<string, MonitorConfig[]>();
  private sequence = 0;
  private observing = true;
  private lastEvaluation: number;
  readonly restoreStatus: 'new' | 'restored' | 'rejected';

  constructor(
    config: WatchdogConfig,
    readonly clock: Clock,
    saved?: unknown,
  ) {
    this.config = configSchema.parse(config);
    const now = clock.now();
    this.lastEvaluation = now;
    const parsed = snapshotSchema.safeParse(saved);
    const restored =
      parsed.success &&
      parsed.data.policyFingerprint === JSON.stringify(this.config.policy)
        ? parsed.data
        : undefined;
    this.restoreStatus =
      saved === undefined ? 'new' : restored ? 'restored' : 'rejected';
    const matched = new Set<string>();
    for (const m of this.config.monitors) {
      this.monitors.set(m.id, m);
      const compatible =
        restored?.monitorFingerprints[m.id] === monitorFingerprint(m);
      if (compatible) matched.add(m.id);
      const previous = compatible ? restored?.runtimes[m.id] : undefined;
      this.runtimes.set(m.id, {
        state: m.enabled ? 'WARMING_UP' : 'DISABLED',
        lastDeliveryAt: null,
        staleSince: null,
        healthySince: null,
        recoveredAt: null,
        ...previous,
        observationStartedAt: now,
        graceUntil: now + m.staleTimeoutMs,
        evidenceSinceResume: false,
        present: true,
      });
      const group = this.groups.get(m.sourceAppId) ?? [];
      group.push(m);
      this.groups.set(m.sourceAppId, group);
    }
    if (restored) {
      this.sequence = restored.sequence;
      for (const i of restored.devices)
        if (matched.has(i.monitorId)) this.deviceIncidents.set(i.monitorId, i);
      for (const i of restored.integrations)
        if (
          this.groups.has(i.sourceAppId) &&
          [...i.memberIds, ...i.affectedIds].every((id) => matched.has(id))
        ) {
          i.recoveringSince = null;
          this.integrationIncidents.set(i.sourceAppId, i);
        }
    }
    for (const m of this.config.monitors) {
      const r = this.runtime(m.id);
      r.state = m.enabled ? 'WARMING_UP' : 'DISABLED';
      r.healthySince = null;
      if (!this.hasIncident(m)) r.staleSince = null;
    }
  }

  setObserving(value: boolean): void {
    if (this.observing === value) return;
    this.observing = value;
    if (value) this.resume();
  }

  /** In-process config edits preserve only state covered by the existing fingerprints.
   * Restarts still use the constructor's full observation grace. */
  reconfigure(config: WatchdogConfig): WatchdogEngine {
    const next = new WatchdogEngine(config, this.clock, this.snapshot());
    next.observing = this.observing;
    next.lastEvaluation = this.lastEvaluation;
    if (
      JSON.stringify(next.config.policy) !== JSON.stringify(this.config.policy)
    )
      return next;
    for (const m of next.config.monitors) {
      const previous = this.monitors.get(m.id);
      if (previous && monitorFingerprint(previous) === monitorFingerprint(m))
        next.runtimes.set(m.id, structuredClone(this.runtime(m.id)));
    }
    for (const [source, incident] of next.integrationIncidents) {
      incident.recoveringSince =
        this.integrationIncidents.get(source)?.recoveringSince ?? null;
    }
    return next;
  }

  private resume(): void {
    const now = this.clock.now();
    for (const m of this.config.monitors) {
      const r = this.runtime(m.id);
      r.observationStartedAt = now;
      r.graceUntil = now + m.staleTimeoutMs;
      r.evidenceSinceResume = false;
      r.healthySince = null;
      r.state = 'WARMING_UP';
      if (!this.hasIncident(m)) {
        r.staleSince = null;
      }
    }
    for (const i of this.integrationIncidents.values())
      i.recoveringSince = null;
    this.lastEvaluation = now;
  }

  setPresent(id: string, present: boolean): void {
    const r = this.runtime(id);
    if (r.present === present) return;
    r.present = present;
    if (present) {
      const m = this.monitor(id);
      r.observationStartedAt = this.clock.now();
      r.graceUntil = this.clock.now() + m.staleTimeoutMs;
      r.evidenceSinceResume = false;
      r.healthySince = null;
      r.state = 'WARMING_UP';
    }
  }

  recordDelivery(id: string, deliveredAt: number): boolean {
    const r = this.runtime(id);
    const m = this.monitor(id);
    const now = this.clock.now();
    if (
      !m.enabled ||
      !r.present ||
      !this.observing ||
      !Number.isFinite(deliveredAt) ||
      deliveredAt < 0 ||
      deliveredAt > now ||
      (r.lastDeliveryAt !== null && deliveredAt <= r.lastDeliveryAt)
    )
      return false;
    r.lastDeliveryAt = deliveredAt;
    // Old retained data informs age but cannot satisfy the post-reconnect recovery gate.
    if (deliveredAt >= r.observationStartedAt) r.evidenceSinceResume = true;
    return true;
  }

  private hasIncident(m: MonitorConfig): boolean {
    return (
      this.deviceIncidents.has(m.id) ||
      (this.integrationIncidents
        .get(m.sourceAppId)
        ?.affectedIds.includes(m.id) ??
        false)
    );
  }

  evaluate(): WatchdogEvent[] {
    const now = this.clock.now();
    if (now < this.lastEvaluation) {
      this.resume();
      return [];
    }
    this.lastEvaluation = now;
    if (!this.observing) return [];
    const events: WatchdogEvent[] = [];
    const p = this.config.policy;
    for (const m of this.config.monitors) {
      const r = this.runtime(m.id);
      if (!m.enabled || !r.present) continue;
      const fresh =
        r.evidenceSinceResume &&
        r.lastDeliveryAt !== null &&
        now - r.lastDeliveryAt < m.staleTimeoutMs;
      if (fresh) {
        if (this.hasIncident(m)) {
          r.healthySince ??= now;
          r.state =
            now - r.healthySince >= p.recoveryStabilityMs
              ? 'HEALTHY'
              : 'RECOVERING';
          if (r.state === 'HEALTHY') r.recoveredAt ??= now;
        } else {
          r.state = 'HEALTHY';
          r.staleSince = null;
          r.healthySince = null;
        }
      } else {
        r.healthySince = null;
        if (now < r.graceUntil) {
          r.state = 'WARMING_UP';
          continue;
        }
        const boundary = Math.max(
          r.graceUntil,
          (r.lastDeliveryAt ?? r.observationStartedAt) + m.staleTimeoutMs,
        );
        if (now < boundary) {
          r.state = 'WARMING_UP';
          continue;
        }
        r.staleSince ??= boundary;
        r.recoveredAt = null;
        r.state =
          now - r.staleSince >= p.correlationWindowMs
            ? 'DEVICE_STALE'
            : 'SUSPECTED_STALE';
      }
    }

    for (const [source, all] of this.groups) {
      const selected = all.filter((m) => m.enabled);
      if (!selected.length) continue;
      const stale = selected.filter((m) =>
        ['SUSPECTED_STALE', 'DEVICE_STALE'].includes(this.status(m.id)),
      );
      let integration = this.integrationIncidents.get(source);
      if (!integration) {
        // Sliding window, not earliest-ever failure: pre-existing defects must not block a later cohort.
        const sorted = [...stale].sort(
          (a, b) =>
            this.runtime(a.id).staleSince! - this.runtime(b.id).staleSince!,
        );
        const cohort = sorted.find((m, index) => {
          const start = this.runtime(m.id).staleSince!;
          const count = sorted
            .slice(index)
            .filter(
              (x) =>
                this.runtime(x.id).staleSince! - start <= p.correlationWindowMs,
            ).length;
          return (
            count >= p.minStaleDevices &&
            count / selected.length >= p.staleFraction &&
            now - start >= p.correlationWindowMs
          );
        });
        if (cohort) {
          integration = {
            id: this.nextId(source, now),
            sourceAppId: source,
            memberIds: selected.map((m) => m.id),
            affectedIds: stale.map((m) => m.id),
            startedAt: Math.min(
              ...stale.map((m) => this.runtime(m.id).staleSince!),
            ),
            recoveringSince: null,
          };
          this.integrationIncidents.set(source, integration);
          events.push(
            this.integrationEvent('integration_stale', integration, now),
          );
        }
      }
      if (integration) {
        for (const m of stale)
          if (!integration.affectedIds.includes(m.id))
            integration.affectedIds.push(m.id);
        const healthy = integration.memberIds.filter(
          (id) => this.status(id) === 'HEALTHY',
        ).length;
        if (healthy / integration.memberIds.length >= p.recoveryFraction) {
          integration.recoveringSince ??= now;
          if (now - integration.recoveringSince >= p.recoveryStabilityMs) {
            events.push(
              this.integrationEvent('integration_recovered', integration, now),
            );
            this.integrationIncidents.delete(source);
            // Absorb recovered individual incidents; residual ones retain their original identity.
            for (const id of integration.affectedIds)
              if (this.status(id) === 'HEALTHY') {
                this.deviceIncidents.delete(id);
                this.runtime(id).staleSince = null;
              }
            integration = undefined;
          }
        } else integration.recoveringSince = null;
      }
      if (integration) continue;
      for (const m of selected) {
        const r = this.runtime(m.id);
        const open = this.deviceIncidents.get(m.id);
        if (this.status(m.id) === 'DEVICE_STALE' && !open) {
          const incident = {
            id: this.nextId(m.id, now),
            monitorId: m.id,
            startedAt: r.staleSince!,
          };
          this.deviceIncidents.set(m.id, incident);
          events.push(this.deviceEvent('device_stale', m, incident, now));
        } else if (this.status(m.id) === 'HEALTHY' && open) {
          events.push(this.deviceEvent('device_recovered', m, open, now));
          this.deviceIncidents.delete(m.id);
          r.staleSince = null;
          r.healthySince = null;
        }
      }
    }
    return events;
  }

  private nextId(scope: string, now: number): string {
    return `${scope}:${now}:${++this.sequence}`;
  }
  monitor(id: string): MonitorConfig {
    const m = this.monitors.get(id);
    if (!m) throw new Error('Unknown monitor');
    return m;
  }
  private runtime(id: string): MonitorRuntime {
    const r = this.runtimes.get(id);
    if (!r) throw new Error('Unknown monitor');
    return r;
  }
  status(id: string): MonitorRuntime['state'] {
    const r = this.runtime(id);
    if (!this.monitor(id).enabled) return 'DISABLED';
    if (!r.present) return 'MISSING';
    return this.observing ? r.state : 'UNKNOWN';
  }
  integrationStatus(source: string): string {
    const selected = (this.groups.get(source) ?? []).filter((m) => m.enabled);
    if (!selected.length || !this.observing) return 'UNKNOWN';
    const incident = this.integrationIncidents.get(source);
    if (incident)
      return incident.recoveringSince === null
        ? 'INTEGRATION_STALE'
        : 'RECOVERING';
    const states = selected.map((m) => this.status(m.id));
    if (states.every((s) => s === 'HEALTHY')) return 'HEALTHY';
    if (
      states.some((s) =>
        ['DEVICE_STALE', 'SUSPECTED_STALE', 'RECOVERING'].includes(s),
      )
    )
      return 'DEGRADED';
    return 'UNKNOWN';
  }
  runtimeView(id: string): MonitorRuntime {
    return { ...this.runtime(id), state: this.status(id) };
  }
  snapshot(): Snapshot {
    return structuredClone({
      version: 1,
      sequence: this.sequence,
      fingerprint: detectionFingerprint(this.config),
      monitorFingerprints: Object.fromEntries(
        this.config.monitors.map((m) => [m.id, monitorFingerprint(m)]),
      ),
      policyFingerprint: JSON.stringify(this.config.policy),
      runtimes: Object.fromEntries(this.runtimes),
      devices: [...this.deviceIncidents.values()],
      integrations: [...this.integrationIncidents.values()],
    });
  }
  private deviceEvent(
    type: 'device_stale' | 'device_recovered',
    m: MonitorConfig,
    incident: DeviceIncident,
    at: number,
  ): WatchdogEvent {
    return {
      type,
      incidentId: incident.id,
      at,
      startedAt: incident.startedAt,
      sourceAppId: m.sourceAppId,
      sourceAppName: m.sourceAppName,
      monitor: structuredClone(m),
      lastDeliveryAt: this.runtime(m.id).lastDeliveryAt,
      affectedDevices: type === 'device_stale' ? [m.deviceName] : [],
      affectedCount: type === 'device_stale' ? 1 : 0,
      monitoredCount: 1,
      recoveredCount: type === 'device_recovered' ? 1 : 0,
      evidenceKind:
        m.strategy.kind === 'device-last-seen'
          ? 'device-activity'
          : 'data-delivery',
    };
  }
  private integrationEvent(
    type: 'integration_stale' | 'integration_recovered',
    i: IntegrationIncident,
    at: number,
  ): WatchdogEvent {
    const participantIds = [...new Set([...i.memberIds, ...i.affectedIds])];
    const members = participantIds.map((id) => this.monitor(id));
    const affected = participantIds.filter((id) =>
      type === 'integration_stale'
        ? ['SUSPECTED_STALE', 'DEVICE_STALE'].includes(this.status(id))
        : this.status(id) !== 'HEALTHY',
    );
    return {
      type,
      incidentId: i.id,
      at,
      startedAt: i.startedAt,
      sourceAppId: i.sourceAppId,
      sourceAppName: members[0].sourceAppName,
      lastDeliveryAt: null,
      affectedDevices: affected.map((id) => this.monitor(id).deviceName),
      affectedCount: affected.length,
      monitoredCount: participantIds.length,
      recoveredCount: participantIds.filter(
        (id) => this.status(id) === 'HEALTHY',
      ).length,
      evidenceKind: members.every((m) => m.strategy.kind !== 'device-last-seen')
        ? 'data-delivery'
        : 'includes-device-activity',
    };
  }
}
