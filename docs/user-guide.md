# Data Watchdog User Guide

Data Watchdog helps you notice when a Homey device or integration stops reporting. This guide explains how to choose a useful signal, set up a monitor and receive notifications. You only need to know how to open an app's settings and create a Homey Flow.

Open **Data Watchdog → Settings** to configure monitoring. The same basic guidance is available there under **How to use Data Watchdog**, without opening a website.

## What Data Watchdog does

A device can remain visible in Homey even when its source has stopped sending updates. Data Watchdog watches a signal that confirms activity or successful data delivery. If that signal is absent for too long, it detects an incident. When updates return and remain stable, it closes the incident.

It does **not** simply check whether a measurement changes. A temperature can stay at **21.3 °C** for hours while the sensor works perfectly. The useful question is whether the source is still reporting, not whether the room temperature changed.

You choose which devices to monitor. New devices are not monitored automatically, and you do not need to monitor every device. Data Watchdog does not repair or restart a failing integration.

## Quick start

1. Open Data Watchdog's settings and find **Add monitor**.
2. Choose the **Integration** and **Device** you want to monitor.
3. Under **How should freshness be checked?**, choose a method supported by that source. Use the guidance below rather than guessing.
4. Enter the **Expected update interval (minutes)**: how often the source normally reports.
5. Enter **Consider stale after (minutes)**: how long a gap you are willing to allow. Give normal delays some margin.
6. Leave **Monitor enabled** checked. **Technical note** under **Advanced (optional)** can stay empty.
7. Select **Add monitor**. If something needs correction, the relevant field is highlighted and a message appears beside the save action.
8. Use **Refresh status** to see current monitoring information. A new monitor normally begins at WARMING_UP and needs a fresh update before becoming HEALTHY.
9. For phone notifications, create a Flow using **Any watchdog incident started**, as described in [Getting notifications](#getting-notifications).

There can be one monitor per device. If a monitor already exists, use **Edit** on its card.

## Choosing a freshness method

Choose the method that best matches what the source can actually prove. A method's availability depends on the device and its integration. If no reliable signal exists, it is better to leave the device unmonitored than to rely on an unrelated value.

### Device activity

Use this when Homey's last-seen information reliably advances when the device or source is active.

This can be useful for checking that a source is still responding. However, **activity does not necessarily prove that a new measurement was delivered**. For example, a device could respond to a command while its measurement updates have stopped.

Not every device or integration provides useful last-seen information. A device appearing available in Homey is not enough on its own. If this method never receives fresh activity, look for a genuine Delivery timestamp or a supported Explicit heartbeat instead.

### Delivery timestamp

Use this when the source exposes a date/time field that is updated whenever new data is delivered. When its meaning is known, a genuine delivery timestamp is usually the strongest choice for checking data delivery.

1. Select the field containing that delivery time. Its readable title is shown above its smaller technical name.
2. Select the matching **Timestamp format**:
   - **Date and time (ISO, with timezone)** for a date/time value with timezone information.
   - **Unix time in seconds** or **Unix time in milliseconds** if the source documents that numeric format.
3. Check that the time advances after actual new deliveries.

Choose a time field, **not a temperature, energy counter, battery percentage or other measurement**. Do not choose a clock that keeps ticking independently of delivery. A field's title or numeric type cannot prove its meaning; consult the source's documentation if uncertain.

If only one supported field is listed, it is automatically selected. You must still check that it represents a real delivery time. If several fields are selected, a new timestamp in **any one** counts as an update. This does not confirm that every measurement is fresh.

For the optional local test device, choose **Last test heartbeat** (`last_test_heartbeat`) and the ISO format.

### Explicit heartbeat

Use this when a Flow, integration or API can explicitly confirm that a delivery succeeded. A heartbeat is simply that confirmation.

For example, an integration might run a successful synchronization and then notify Data Watchdog. In a Flow, the Data Watchdog action **Record a confirmed delivery** takes the chosen monitor and the actual delivery timestamp in ISO format with timezone. The integration or Flow must supply that information from the successful delivery.

Selecting this method does not create a heartbeat sender. If your source cannot provide a success signal and its delivery time, another method may be more suitable. API setup is an option for integration developers; ordinary users do not need to write API calls to use the other methods.

**Do not send production heartbeats from a blind repeating timer.** That would only prove that the timer is running, even if the source has failed. The optional test device is intentionally a simulator and is separate from production monitoring.

## Choosing the timing

**Expected update interval (minutes)** describes how often the source normally reports activity or new data.

**Consider stale after (minutes)** is the longest gap without a valid update before the source is treated as stale. It is this timeout that determines when an update is overdue; the expected interval helps you choose a sensible timeout.

For example, if a source normally reports every **5 minutes**, you might set:

| Setting                  | Example    |
| ------------------------ | ---------- |
| Expected update interval | 5 minutes  |
| Consider stale after     | 15 minutes |

This allows some margin for delayed updates. A very tight timeout may produce unnecessary incidents. A much longer timeout takes longer to warn you.

- Both values must be greater than zero.
- The stale timeout must be at least the expected interval.
- Device activity and Delivery timestamp require a stale timeout of at least **2 minutes**.
- The input arrows use **0.5-minute steps**. `0.5` means 30 seconds; `1.5` means 90 seconds.
- The maximum accepted duration is one year. The existing validation still accepts manually entered values that meet the timing rules; half-minute arrow steps do not change the monitoring rules.

An incident may be reported slightly after the stale timeout because Data Watchdog briefly waits to confirm and group related problems. Recovery is also confirmed over a stable period, rather than immediately closing an incident after one returning update.

For sources that only report when something happens, a quiet period may be normal. Choose a suitable periodic activity signal if one exists; otherwise this form of monitoring may not fit that device.

## Understanding monitor statuses

| Status              | Meaning                                                                                                                        | What to do                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **WARMING_UP**      | Waiting for a fresh update after setup, restart or a change to detection settings.                                             | Allow the source to report and check that the chosen signal is valid. |
| **HEALTHY**         | Recent valid activity or data delivery has been confirmed.                                                                     | No action is needed for this signal.                                  |
| **SUSPECTED_STALE** | The signal is overdue; Data Watchdog is waiting briefly before declaring an incident.                                          | Check whether updates resume or an incident follows.                  |
| **DEVICE_STALE**    | The device has missed the configured stale period and an incident is active. It may be part of a grouped integration incident. | Investigate the device or source integration.                         |
| **RECOVERING**      | Fresh updates have returned, but stable recovery has not yet been confirmed.                                                   | Allow updates to continue.                                            |
| **DISABLED**        | Monitoring is turned off for this monitor.                                                                                     | Enable it when you want monitoring to resume.                         |
| **MISSING**         | The configured device or required timestamp field cannot currently be found.                                                   | Refresh status and check the device and selected field.               |
| **UNKNOWN**         | Data Watchdog cannot currently determine a reliable state, for example because observation is unavailable.                     | Check Observation status and Homey's availability.                    |

The card's **Last delivery** shows the most recently accepted signal. With Device activity, it represents accepted activity, not necessarily a new measurement. **Technical details** contains the exact time and identifiers if you need support.

**Observation status** describes Data Watchdog's ability to observe Homey. **Connected** does not mean every monitored device is healthy. **Dispatch failures** counts failed attempts to send watchdog events to Flows; zero is not proof that a push arrived on your phone. Full troubleshooting information is available under **Diagnostics**.

## Getting notifications

Data Watchdog detects incidents but does **not** automatically send every user a push notification. Homey Flows let you decide who receives messages, which incidents matter and whether to announce recovery.

Create a Flow such as:

| Flow part | Choose                                                                      |
| --------- | --------------------------------------------------------------------------- |
| **WHEN**  | Data Watchdog → **Any watchdog incident started**                           |
| **THEN**  | Homey's **Send a push notification** action; choose a recipient and message |

An example message is “Data Watchdog: a source has stopped reporting.” Use the integration/device information supplied by the trigger to make the message more useful. Exact Homey action wording may vary with your language and app version.

For recovery notifications, create a separate Flow with **Any watchdog incident recovered**, for example “Data Watchdog: reporting has recovered.”

You can add your own Flow conditions to limit which incidents are reported. Avoid sending the same notification from both an **Any watchdog incident** trigger and a device- or integration-specific trigger, unless you deliberately want both.

If several monitored devices from the same integration stop reporting together, Data Watchdog can treat them as one integration incident. The general **Any watchdog incident** cards cover both individual and grouped incidents, which helps avoid a burst of separate messages for one shared problem.

## Editing and disabling monitors

Select **Edit** on a monitor card to load its settings. **Save changes** updates that same monitor; it does not create a duplicate. **Cancel** discards the unsaved draft. If saving fails, the draft stays available and an error explains what to check.

The integration and device remain fixed during editing. To monitor a different device, add a monitor for that device instead.

Changes to the freshness method, selected timestamp fields, format or timing start a new observation period. Disabling and re-enabling monitoring also requires fresh updates. Do not interpret a new WARMING_UP period after such a change as evidence of a device failure.

**Technical note** under **Advanced (optional)** is just a reminder of why you trust the chosen signal. It is optional and does not affect detection, restart monitoring or reset an incident's recovery progress.

- **Disable** stops monitoring that device while keeping its configuration.
- **Enable** resumes monitoring with a fresh observation period.
- **Remove** removes the monitor, not the actual Homey device.

Removing, disabling or changing detection rules during an incident may end that incident administratively without a recovery notification. Recovery notifications are intended to confirm recovered reporting, not a configuration change.

## Using the local self-test

The optional **Data Watchdog Test Source (simulation)** lets you safely test stale detection, recovery and your notification Flows. It runs locally in Data Watchdog, does not control production devices, and does not require another integration or backend. It is not needed for everyday monitoring.

### Set up the optional device

1. In Homey, add **Data Watchdog Test Source (simulation)** from Data Watchdog's devices. If it is already paired, use that existing device.
2. Open Data Watchdog settings and use **Refresh status**. Newly added devices may take around a minute to appear.
3. Add a monitor for the test device, or edit its existing monitor.
4. Choose **Delivery timestamp**, **Last test heartbeat**, ISO format, an expected interval of **0.5 minutes** and a stale timeout of **3 minutes**. The technical note can remain empty.

### Understand the controls

| Control             | What happens                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **Start heartbeat** | Sends a heartbeat now, then every 30 seconds. Status becomes RUNNING.                           |
| **Stop**            | Stops generating heartbeats. The last test timestamp stays unchanged.                           |
| **Send once**       | Sends one heartbeat without starting a stopped simulator. If already RUNNING, it stays running. |

After every app restart, the simulator deliberately starts **STOPPED**. Restarting it is not itself a test heartbeat. Its previous timestamp may still be displayed.

### Try an incident and recovery

1. Start the heartbeat and use Refresh status until the monitor is HEALTHY.
2. Stop it. The last timestamp should stop advancing.
3. Wait through the configured stale timeout and the brief confirmation period. The monitor should pass through SUSPECTED_STALE to DEVICE_STALE.
4. If configured, your normal incident Flow sends a real test notification.
5. Start the heartbeat again. The monitor should move through RECOVERING to HEALTHY once recovery is stable. A configured recovery Flow can send a second notification.
6. When finished, disable only the **test monitor** and stop the simulator so it does not produce another planned stale incident.

The same device can be used with **Explicit heartbeat** or **Device activity** by editing its monitor. With Explicit heartbeat, **Send once** can confirm a delivery while the simulator remains STOPPED. Device activity relies on Homey's actual last-seen information. Test each method in turn; there is one monitor per device.

## Troubleshooting

### A monitor stays WARMING_UP

Data Watchdog is waiting for fresh evidence after setup, restart or a detection-setting change. An old displayed value is not enough. Check that the source is actually producing new activity or delivery confirmations, and that the chosen freshness method matches that source. Also check Observation status; interruptions can start a new observation period.

### A monitor becomes MISSING

Use **Refresh status** and check that the device still exists and the selected timestamp field is still available. The device list may not yet reflect a recent addition or an integration change.

A normal rename alone does not break monitoring: Data Watchdog follows the device's identity. After renaming, look for its current name. A deleted and re-added device may have a new identity and require a new monitor. A disappeared timestamp field needs a suitable replacement in Edit. MISSING is not treated as recovery.

### Delivery timestamp never becomes HEALTHY

Check all three points:

- You selected a genuine delivery timestamp, not a measurement or an independently ticking clock.
- **Timestamp format** matches the source, including seconds versus milliseconds or ISO with timezone.
- The time actually advances after successful new deliveries. Invalid, future or repeatedly unchanged timestamps do not provide fresh proof.

If you do not know what a field means, check the integration's documentation before relying on it.

### Device activity never becomes HEALTHY

Not every device or integration supplies reliable last-seen information. A visible or available device does not guarantee that this time is updated. If activity is not reported, use Delivery timestamp or Explicit heartbeat when the source supports one of them.

### Explicit heartbeat never becomes HEALTHY

Choosing this method does not automatically send confirmations. Check that the Flow or integration actually confirms a successful delivery to the intended monitor and supplies that delivery's timestamp. Repeating an old timestamp does not create new evidence. Do not replace a missing success signal with a blind timer.

### No phone notification arrives

Detection and notification are separate. Check that:

1. A Flow uses **Any watchdog incident started** and has a push-notification action.
2. The Flow is enabled and its conditions allow this incident, including simulator incidents if you are testing.
3. The intended person is the recipient, Homey notifications are allowed on their phone, and notification settings such as Focus mode are not hiding the message.
4. **Observation status** does not show a dispatch failure.

A newly configured Flow does not replay an old incident start. To test the whole chain, use the optional simulator to produce a new incident after recovery. Use Homey's Flow test feature to check the notification action separately if needed.

### Alerts seem repeated

First check for overlapping Flows: using both a general incident trigger and a device-specific trigger for the same push can create duplicate notifications. Also check whether the source genuinely recovers and then stops reporting again, which can produce a new incident.

A single device problem can be reported individually. When several monitors from the same integration stop reporting together, Data Watchdog can group them into one integration incident. Individual device statuses can still show a problem while the shared incident is active. The **Any watchdog incident** triggers are the simplest starting point for general notifications.

### Add monitor or Save changes does not succeed

Read the message next to the action and the highlighted field. Check device selection, timestamp selection and timing. No timestamp fields are needed for Device activity or Explicit heartbeat. Technical note can be empty.

After a failed save, your draft remains available. After a successful save followed by a status-refresh failure, the message says the monitor was saved; use Refresh status instead of creating another monitor.

## Good monitoring examples

### Temperature sensor or thermostat

A steady temperature is normal, so “temperature did not change” is not a useful failure signal. If the source has reliable last-seen information, Device activity may check that it is still active. If it provides a genuine time of its most recent data delivery, prefer Delivery timestamp for checking that delivery.

Allow timing margins appropriate to the actual reporting schedule. A battery-powered sensor may report less frequently than a mains-powered thermostat.

### Periodically synchronized integration

An integration that normally completes a synchronization every five minutes could expose the completion time as a Delivery timestamp. Alternatively, if it can send a confirmation after a successful synchronization, Explicit heartbeat may be suitable. A five-minute expected interval and fifteen-minute stale timeout is a possible starting point, not a universal recommendation.

A failed synchronization must not update the success timestamp or send a success heartbeat.

### Event-only device

A button or door sensor can legitimately stay quiet for a long time. Do not declare it faulty simply because nobody pressed the button or opened the door. Use a reliable periodic activity signal if the source provides one; otherwise leave it unmonitored rather than assigning an unsuitable timeout.

## Important limitations

- An unchanged measurement is not proof of a fault.
- Device activity proves activity, not necessarily delivery of new measurement data.
- Monitoring is only as reliable as the selected freshness signal. Data Watchdog cannot tell that a source is wrongly presenting old data as newly delivered.
- A wrong timestamp field can create false confidence. Confirm what updates it before relying on it.
- Notifications depend on your Homey Flows and the phone's notification setup. A detected incident is not a guarantee that a phone received a message.
- **A watchdog running on the same Homey cannot report a complete outage of that Homey while it is stopped.** For whole-host outage detection, you need a separate monitor running outside that Homey. External heartbeat or host monitoring could be a separate future solution; it is not provided by this app.
