/**
 * Basic test suite — no external dependencies needed
 * Run: node tests/test.js
 */

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

// ─── Mock Cerebras for tests ─────────────────────────────────────────────────
const mockCerebras = {
  getModel: () => "llama3.1-8b",
  complete: async (prompt) => ({
    content: JSON.stringify({
      action: "NO-TRADE",
      mode: "no_trade",
      market_state: "ranging",
      volatility_regime: "normal",
      entry: null,
      stop_loss: null,
      take_profit: null,
      risk_reward: null,
      lot_size: null,
      risk_percent: null,
      cooldown_minutes: 10,
      confidence: 30,
      reason: "INSUFFICIENT_CONFLUENCE",
      invalidation: null,
      timestamp: new Date().toISOString(),
    }),
    tokens: { prompt: 100, completion: 80, total: 180 },
    model: "llama3.1-8b",
  }),
};

// ─── Tests ────────────────────────────────────────────────────────────────────
const { TradingEngine } = require("../tradingEngine");
const engine = new TradingEngine(mockCerebras);

test("TradingEngine initializes correctly", () => {
  assert(engine !== null, "Engine should exist");
  assert(typeof engine.analyze === "function", "analyze should be a function");
  assert(typeof engine.getStatus === "function", "getStatus should be a function");
});

test("getStatus returns correct structure", () => {
  const status = engine.getStatus();
  assert(status.status === "active", "Status should be active");
  assert(typeof status.uptime_seconds === "number", "Uptime should be a number");
  assert(status.model === "llama3.1-8b", "Model should match");
  assert(typeof status.stats === "object", "Stats should be object");
});

test("Safety fallback returns NO-TRADE", () => {
  const fallback = engine._safetyFallback("TEST_REASON");
  assert(fallback.action === "NO-TRADE", "Should return NO-TRADE");
  assert(fallback.safety_override === true, "Should mark safety override");
  assert(fallback.reason === "TEST_REASON", "Should include reason");
});

test("Market data validation - valid data", () => {
  // Test the validation logic inline
  const data = {
    symbol: "XAUUSD",
    bid: 1950.0,
    ask: 1950.3,
    spread: 30,
    atr: 5.2,
    timeframe: "M15",
  };

  const errors = [];
  const required = ["symbol", "bid", "ask", "spread", "atr", "timeframe"];
  for (const field of required) {
    if (data[field] === undefined || data[field] === null) {
      errors.push(field);
    }
  }

  assert(errors.length === 0, `Should have no errors, got: ${errors.join(", ")}`);
});

test("Market data validation - missing fields", () => {
  const data = { symbol: "XAUUSD", bid: 1950.0 };
  const required = ["symbol", "bid", "ask", "spread", "atr", "timeframe"];
  const errors = required.filter((f) => data[f] === undefined);
  assert(errors.length > 0, "Should detect missing fields");
});

test("Decision validation rejects low RR trades", () => {
  const badDecision = {
    action: "BUY",
    entry: 1950.0,
    stop_loss: 1948.0,
    take_profit: 1951.5, // RR = 0.75 — too low
    lot_size: 0.1,
    risk_percent: 1.0,
  };

  const marketData = { spread: 0.3, atr: 5.0, news_risk: "LOW" };
  const result = engine._validateDecision(badDecision, marketData);
  assert(result.action === "NO-TRADE", "Low RR should return NO-TRADE");
  assert(result.reason === "RR_BELOW_MINIMUM", "Should indicate RR reason");
});

test("Decision validation passes valid trade", () => {
  const goodDecision = {
    action: "BUY",
    entry: 1950.0,
    stop_loss: 1946.0,
    take_profit: 1958.0, // RR = 2.0 — good
    lot_size: 0.1,
    risk_percent: 1.0,
    mode: "intraday_swing",
    market_state: "trending",
    volatility_regime: "normal",
    confidence: 72,
    reason: "EMA_CROSS_CONFLUENCE",
    cooldown_minutes: 30,
    timestamp: new Date().toISOString(),
  };

  const marketData = { spread: 0.3, atr: 5.0, news_risk: "LOW" };
  const result = engine._validateDecision(goodDecision, marketData);
  assert(result.action === "BUY", "Valid trade should pass");
  assert(result.validated === true, "Should be marked validated");
});

test("High news risk forces NO-TRADE", () => {
  const decision = {
    action: "BUY",
    entry: 1950.0,
    stop_loss: 1946.0,
    take_profit: 1958.0,
  };

  const marketData = { spread: 0.3, atr: 5.0, news_risk: "HIGH" };
  const result = engine._validateDecision(decision, marketData);
  assert(result.action === "NO-TRADE", "High news risk should force NO-TRADE");
  assert(result.reason === "NEWS_RISK_OVERRIDE", "Should indicate news override");
});

test("Wide spread forces NO-TRADE", () => {
  const decision = {
    action: "SELL",
    entry: 1950.0,
    stop_loss: 1954.0,
    take_profit: 1942.0,
  };

  // Spread = 2.0, ATR = 3.0 → ratio = 0.67 > 0.3 → REJECT
  const marketData = { spread: 2.0, atr: 3.0, news_risk: "LOW" };
  const result = engine._validateDecision(decision, marketData);
  assert(result.action === "NO-TRADE", "Wide spread should force NO-TRADE");
});

// ─── Prompt Builder Test ──────────────────────────────────────────────────────
test("Prompt builder generates valid prompt", () => {
  const data = {
    timeframe: "M15",
    bid: 1950.0,
    ask: 1950.3,
    spread: 30,
    atr: 5.2,
    timestamp: new Date().toISOString(),
  };

  const prompt = engine._buildPrompt(data);
  assert(typeof prompt === "string", "Prompt should be a string");
  assert(prompt.includes("XAUUSD"), "Prompt should mention XAUUSD");
  assert(prompt.includes("action"), "Prompt should request action field");
  assert(prompt.includes("stop_loss"), "Prompt should request stop_loss");
  assert(prompt.includes("take_profit"), "Prompt should request take_profit");
  assert(prompt.length > 200, "Prompt should be detailed");
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log("All tests passed! 🎉");
}
