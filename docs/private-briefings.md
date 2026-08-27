# Private owner briefings

Jolene can deliver a deterministic morning or weekly briefing to Carl's exact
configured Slack DM. This is a private local runtime feature. It is not a
general messaging capability and it does not use the model to compose or choose
recipients.

## Configuration

Set `JOLENE_PRIVATE_BRIEFING` to one JSON object or place the same object in the
ignored `.jolene/private-briefing.json` file:

```json
{
  "enabled": true,
  "destination": "slack_owner_dm",
  "frequency": "daily",
  "dayOfWeek": null,
  "localHour": 8,
  "localMinute": 0,
  "timeZone": "America/Los_Angeles",
  "maxDeliveriesPerDay": 1,
  "stopAfterDeliveries": 365,
  "historyLimit": 90,
  "maxAttempts": 5
}
```

Weekly schedules require `dayOfWeek`, where Sunday is `0` and Saturday is `6`.
The time zone must be an IANA zone. A newly enabled schedule starts at the next
wall-clock occurrence; application startup never triggers an immediate
briefing.

The checked-in Compose configuration enables one daily 8:00 AM
`America/Los_Angeles` briefing. The ignored host configuration carries the same
owner preference. The example environment remains disabled by default.

## Durable delivery

SQLite retains the owner scope, policy, next and last run times, daily budget,
terminal delivery count, exact generated message, delivery state, bounded
attempt count, classified error code, and bounded history. A due occurrence is
claimed transactionally, advances to the next scheduled wall-clock occurrence,
and cannot be claimed again by a second process. Failed posts retry the exact
stored message with bounded backoff. Restart preserves overdue work and recovers
an interrupted claim after the stale-claim window.

Pause and resume are same-origin local controls. Resume schedules the next
future occurrence rather than sending immediately. Reaching
`stopAfterDeliveries` is terminal.

## Content boundary

The briefing can contain only:

- bounded task titles and status counts;
- bounded active and attention task lists;
- aggregate workflow status counts;
- the aggregate number of pending exact-action proposals;
- bounded watched-project labels and fixed alert labels; and
- the loopback Work control-center URL.

It excludes task objectives, workflow event summaries, proposal content,
destinations, vault and career evidence, contact data, paths, Git revisions and
diffs, secrets, Slack IDs, arbitrary recipients, raw provider errors, and model
output. Task and project labels are escaped so stored text cannot create a Slack
mention.

## Review and controls

Open `http://127.0.0.1:8421/work`. The private briefing panel shows the schedule,
status, next and last run, daily and terminal budgets, the currently generated
minimized preview, and bounded delivery history. It also exposes same-origin
Pause and Resume controls.

The local API boundary is:

- `GET /v1/private-briefing`
- `POST /v1/private-briefing/pause`
- `POST /v1/private-briefing/resume`

No route can change the recipient, message, task state, project files, approval
payload, or delivery content.
