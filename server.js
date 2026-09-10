const express = require("express");
const session = require("express-session");
const path = require("path");
const apiRouter = require("./routes/api");

const app = express();
const PORT = process.env.PORT || 5500;

app.use(express.json());
app.use(session({
  secret: "ensk-portal-session-secret-2026",
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh the expiry on every request, so an active session (e.g. a
                  // long extension test run) never times out mid-use -- it only expires
                  // after a full 30 days of genuine inactivity.
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Final safety net: any error passed to next(err) anywhere above lands here as a
// JSON 500 instead of crashing the server or leaking a stack trace to the client.
app.use((err, req, res, next) => {
  console.error("[server] request error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const server = app.listen(PORT, () => {
  console.log(`e-Nagrik Seva Kendra portal running at http://localhost:${PORT}`);
});

// If the port is already taken (e.g. an old instance is still running), fail loudly
// with a clear message instead of an unhandled 'error' event crashing the process.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${PORT} is already in use. Stop the other process (or set PORT to a free one) and restart.`);
    process.exit(1);
  } else {
    console.error("[server] Failed to start:", err);
    process.exit(1);
  }
});

// Last-resort nets. Nothing in this app should reach these now that db writes are
// retried/non-throwing (see lib/db.js) -- but if something unexpected does slip
// through, log it and keep serving instead of dying, so one bad request can't take
// the whole portal down mid-demo.
process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception (server kept running):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection (server kept running):", reason);
});
