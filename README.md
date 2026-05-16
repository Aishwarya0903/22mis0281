# Campus Hiring Evaluation — Backend Track

This repository contains the submission for the backend track. Three deliverables:

| Folder | What it is |
|---|---|
| `logging_middleware/` | Reusable `Log(stack, level, package, message)` function that ships structured logs to the test server. Consumed by both apps below. |
| `vehicle_maintence_scheduler/` | Microservice that pulls depots + vehicle tasks from the protected APIs and decides which tasks to service today, maximising total impact within the available mechanic-hours. Runs a 0/1 knapsack DP. |
| `notification_app_be/` | Notification microservice. Stage 6 implementation (priority inbox top-N) is in here. |

`notification_system_design.md` answers Stages 1–6 of the notifications question.

`assessment_screenshots/` contains the API client screenshots (request body, response, response time).

## Running locally

Each app folder is self-contained — `cd` into it, copy `.env.example` to `.env`, fill in credentials, then:

```bash
npm install
npm start
```

The logging middleware is `require`'d via relative path; it does not need to be installed separately, but it does need its own `npm install` once so the `axios` dependency resolves:

```bash
cd logging_middleware && npm install
```

## Credentials

Authentication uses the `clientID`/`clientSecret` pair issued at registration. These belong in `.env` files, never in source. Each app's `.env.example` lists what it needs.

The middleware caches the access token in memory and refreshes it automatically before expiry, so individual log calls don't pay the auth round-trip.

## Notes on choices

A few decisions worth surfacing:

- **Express over plain `http`.** Faster to build, and the JSON middleware + routing is what every reviewer will expect.
- **No external libraries for the scheduling algorithm.** Knapsack is hand-rolled in `vehicle_maintence_scheduler/scheduler.js`.
- **Token refresh is lazy with a 30s safety window.** A request that arrives within 30s of expiry triggers a refresh up front rather than risking a 401 mid-flight.
- **Knapsack capacity = sum of depot mechanic-hours.** The APIs as published don't associate tasks with depots, so the problem reduces to one global budget. See `vehicle_maintence_scheduler/README.md` for the reasoning.
