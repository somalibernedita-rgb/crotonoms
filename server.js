const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { CerebrasClient } = require("./cerebras");
const { TradingEngine } = require("./tradingEngine");
const { logger } = require("./logger");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json({ limit: "10mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Rate limit exceeded", retryAfter: 60 },
});
app.use("/api/", limiter);

// Initialize services
const cerebras = new CerebrasClient();
const tradingEngine = new TradingEngine(cerebras);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "operational",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
  });
});

// ─── Main Decision Endpoint ───────────────────────────────────────────────────
app.post("/api/decision", async (req, res) => {
  const startTime = Date.now();

  try {
    const marketData = req.body;

    // Validate incoming market data
    const validation = validateMarketData(marketData);
    if (!validation.valid) {
      return res.status(400).json({
        error: "Invalid market data",
        details: validation.errors,
      });
    }

    logger.info("Decision request received", {
      symbol: marketData.symbol,
      timeframe: marketData.timeframe,
      bid: marketData.bid,
      ask: marketData.ask,
    });

    // Process through autonomous trading engine
    const decision = await tradingEngine.analyze(marketData);

    const latency = Date.now() - startTime;
    logger.info("Decision generated", {
      action: decision.action,
      latency: `${latency}ms`,
    });

    res.json({
      ...decision,
      meta: {
        latency_ms: latency,
        server_time: new Date().toISOString(),
        model: "llama3.1-8b",
        engine_version: "2.0.0",
      },
    });
  } catch (err) {
    logger.error("Decision error", { error: err.message, stack: err.stack });
    res.status(500).json({
      action: "NO-TRADE",
      reason: "SERVER_ERROR",
      message: "Internal error — trading suspended for safety",
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── Market Analysis Endpoint ─────────────────────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  try {
    const { marketData, depth = "standard" } = req.body;

    if (!marketData) {
      return res.status(400).json({ error: "marketData is required" });
    }

    const analysis = await tradingEngine.deepAnalyze(marketData, depth);
    res.json(analysis);
  } catch (err) {
    logger.error("Analysis error", { error: err.message });
    res.status(500).json({ error: "Analysis failed", details: err.message });
  }
});

// ─── Risk Assessment Endpoint ─────────────────────────────────────────────────
app.post("/api/risk", async (req, res) => {
  try {
    const { trade, accountInfo } = req.body;

    if (!trade || !accountInfo) {
      return res.status(400).json({ error: "trade and accountInfo required" });
    }

    const risk = await tradingEngine.assessRisk(trade, accountInfo);
    res.json(risk);
  } catch (err) {
    logger.error("Risk assessment error", { error: err.message });
    res.status(500).json({ error: "Risk assessment failed" });
  }
});

// ─── Strategy Status ──────────────────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  res.json(tradingEngine.getStatus());
});

// ─── Webhook for GitHub Actions ───────────────────────────────────────────────
app.post("/webhook/github", (req, res) => {
  const event = req.headers["x-github-event"];
  const payload = req.body;

  logger.info("GitHub webhook received", { event, repo: payload.repository?.name });

  if (event === "push" && payload.ref === "refs/heads/main") {
    logger.info("Production deployment triggered via GitHub push");
  }

  res.json({ received: true, event });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error("Unhandled error", { error: err.message });
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 Autonomous Trading Server running on port ${PORT}`);
  logger.info(`🧠 AI Engine: Cerebras llama3.1-8b`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// ─── Validation Helper ────────────────────────────────────────────────────────
function validateMarketData(data) {
  const errors = [];
  const required = ["symbol", "bid", "ask", "spread", "atr", "timeframe"];

  for (const field of required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (data.symbol && data.symbol !== "XAUUSD") {
    errors.push("Symbol must be XAUUSD");
  }

  if (data.bid && data.ask && data.bid >= data.ask) {
    errors.push("Bid must be less than ask");
  }

  return { valid: errors.length === 0, errors };
}

module.exports = app;
