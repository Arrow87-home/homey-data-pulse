# Data Pulse

Know when your Homey data stops arriving.

Data Pulse monitors deliberately selected Homey sources and checks whether the evidence you rely on is still fresh. It uses Homey Flows to notify you when expected activity or data stops arriving, and when reporting recovers.

## Why Data Pulse?

An unchanged temperature does not mean a sensor is broken. A measurement can stay the same while new readings keep arriving. Reliable monitoring needs a signal that actually proves activity or successful data delivery.

Data Pulse is opt-in: you select the sources to monitor and decide what counts as meaningful evidence for each one. It does not automatically monitor every device, battery level or availability state.

## Monitoring methods

### Device activity

Checks whether Homey has seen the device recently. The source must provide reliable last-seen information; activity alone does not prove that new measurement data was delivered.

### Last data received

Uses a field whose **value itself contains the time at which fresh data was received**. A normal measurement value is not a timestamp, and `capability.lastUpdated` is not a substitute for a genuine delivery timestamp. Choose this method only when you know that the source updates the field after receiving new data.

### Flow confirmation

A Homey Flow explicitly confirms a successful update using **Confirm a successful update**. A blind periodic timer is not proof of a successful delivery: confirmation must follow the actual update.

## Incidents and recovery

Related failures within an integration can be grouped into one incident covering multiple affected, selected sources. Recovery is confirmed only after updates remain stable, helping avoid unnecessary separate alerts and repeated recovery notifications during unstable reporting.

Use **Data Pulse incident started** and **Data Pulse incident recovered** in your notification Flows. See the [state-machine documentation](docs/state-machines.md) for technical details.

## Supported Homeys

Data Pulse requires local platform v2 (`platformVersion: 2`) and **Homey 12.9.0 or later**:

- Homey Pro (Early 2023)
- Homey Pro mini
- Homey Pro (2026)
- Homey Self-Hosted Server

Older local Homey models with platformVersion 1 and Homey Cloud are not supported. The runtime checks this requirement; Store distribution restrictions still need confirmation with Athom.

## Installation / Test version

Install the [Homey Test version](https://homey.app/a/io.github.arrow87-home.datawatchdog/test/). This is the Test channel while the App Store release awaits final certification.

Open the app's Settings, choose a monitoring method, select your devices and set their expected timing. The [User Guide](docs/user-guide.md) explains setup and notification Flows. An optional local test source lets you verify monitoring without interrupting a production integration.

## Documentation

- [User Guide](docs/user-guide.md) — setup, notifications and troubleshooting.
- [Architecture](docs/architecture.md) — design decisions and evidence semantics.
- [Local self-test](docs/self-test.md) — safe test scenarios and platform limitations.
- [State machines](docs/state-machines.md) — incident, correlation and recovery details.

## Support

- [Homey Community](https://community.homey.app/t/159768): usage questions, experiences and general discussion.
- [GitHub Issues](https://github.com/Arrow87-home/homey-data-pulse/issues): reproducible bugs and concrete technical problems.

For sensitive security or privacy reports, follow [SECURITY.md](SECURITY.md).

## Development

Use **Node.js 24** for local development and Homey CLI tooling. The app targets the Node.js 22 runtime in the current Homey release configuration.

```sh
npm ci
npm test
npm run lint
npm run build
npm run validate
```

`npm run manifest` regenerates `app.json` from the canonical manifest generator. `npm run check` combines tests, lint, build, formatting and Homey debug validation. Release checks also include `homey app validate --level publish`; validation does not publish the app.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Project status

Data Pulse is actively developed and available through the Homey Test channel. Final App Store certification is pending.

## License

The Data Pulse software is licensed under GPL-3.0-only. See [LICENSE](LICENSE).

No rights to use the Data Pulse name, logo, icon or visual branding as trademarks or product branding are granted by the software license. See [TRADEMARKS.md](TRADEMARKS.md).
