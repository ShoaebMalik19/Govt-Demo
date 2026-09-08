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
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 }
}));

app.use("/api", apiRouter);
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`e-Nagrik Seva Kendra portal running at http://localhost:${PORT}`);
});
