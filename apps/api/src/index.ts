/**
 * ORBB edge API — M0 shell.
 *
 * A Hono application exported as the Worker entrypoint. `GET /healthz` is
 * the liveness probe contract for every ORBB compute surface: it returns
 * `{"ok":true,"service":"orbb-api"}` and touches no bindings, no
 * database, and no secrets, so it works on every environment including
 * local `wrangler dev` and CI dry-run bundling.
 */
import { Hono } from "hono";

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, service: "orbb-api" }));

export default app;
