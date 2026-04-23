/**
 * Test suite — updated for new TradingEngine + Cerebras fix
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

const mockCerebras = {
  getModel: () => "llama3.1-8b",
  complete: async () => ({
    content: JSON.stringify({
      action: "NO-TRADE", mode: "no_trade", market_state: "ranging",
      volatility_regime: "normal", entry: null, stop_loss: null,
      take_profit: null, risk_reward: null, lot_size: null,
      risk_percent: null, cooldown_minutes: 10, confidence: 30,
      reason: "ADX_TOO_LOW", invalidation: null,
      timestamp: new Date().toISOString(),
    }),
    tokens: { prompt: 100, completion: 80, total: 180 },
    model: "llama3.1-8b",
  }),
};

const { TradingEngine } = require("../tradingEngine");
const engine = new TradingEngine(mockCerebras);

test("Engine initializes correctly", () => {
  assert(engine !== null);
  assert(typeof engine.analyze === "function");
  assert(typeof engine.getStatus === "function");
  assert(typeof engine._parseDecision === "function");
  assert(typeof engine._buildPrompt === "function");
});

test("getStatus returns correct structure", () => {
  const s = engine.getStatus();
  assert(s.status === "active");
  assert(typeof s.uptime_seconds === "number");
  assert(s.model === "llama3.1-8b");
  assert(typeof s.stats === "object");
});

test("Safety fallback returns correct shape", () => {
  const fb = engine._safetyFallback("TEST");
  assert(fb.action === "NO-TRADE");
  assert(fb.safety_override === true);
  assert(fb.reason === "TEST");
  assert(fb.validated === false);
  assert(fb.entry === null);
});

test("Parser handles clean JSON", () => {
  const content = JSON.stringify({
    action: "NO-TRADE", mode: "no_trade", market_state: "ranging",
    volatility_regime: "normal", entry: null, stop_loss: null,
    take_profit: null, risk_reward: null, lot_size: null,
    risk_percent: null, cooldown_minutes: 5, confidence: 20,
    reason: "FLAT", invalidation: null, timestamp: new Date().toISOString()
  });
  const result = engine._parseDecision(content, { spread: 0.3, atr: 5 });
  assert(result.action === "NO-TRADE");
  assert(result.validated === true);
});

test("Parser handles text before/after JSON", () => {
  const inner = JSON.stringify({
    action: "NO-TRADE", mode: "no_trade", market_state: "ranging",
    volatility_regime: "normal", entry: null, stop_loss: null,
    take_profit: null, risk_reward: null, lot_size: null,
    risk_percent: null, cooldown_minutes: 5, confidence: 20,
    reason: "FLAT", invalidation: null, timestamp: new Date().toISOString()
  });
  const result = engine._parseDecision("Here is my analysis:\n" + inner + "\nDone.", { spread: 0.3, atr: 5 });
  assert(result.action === "NO-TRADE", "Should parse despite surrounding text");
});

test("Parser handles markdown fences", () => {
  const inner = JSON.stringify({
    action: "NO-TRADE", mode: "no_trade", market_state: "ranging",
    volatility_regime: "normal", entry: null, stop_loss: null,
    take_profit: null, risk_reward: null, lot_size: null,
    risk_percent: null, cooldown_minutes: 5, confidence: 20,
    reason: "FLAT", invalidation: null, timestamp: new Date().toISOString()
  });
  const result = engine._parseDecision("```json\n" + inner + "\n```", { spread: 0.3, atr: 5 });
  assert(result.action === "NO-TRADE", "Should parse despite markdown fences");
});

test("Parser returns PARSE_FAILED when no braces", () => {
  const result = engine._parseDecision("sorry cannot trade", {});
  assert(result.action === "NO-TRADE");
  assert(result.reason === "PARSE_FAILED");
});

test("Validator rejects invalid action", () => {
  const r = engine._validateDecision({ action: "HOLD" }, {});
  assert(r.action === "NO-TRADE");
  assert(r.reason === "INVALID_ACTION");
});

test("Validator rejects BUY with missing params", () => {
  const r = engine._validateDecision({ action: "BUY", entry: 2345, stop_loss: null, take_profit: null }, {});
  assert(r.action === "NO-TRADE");
  assert(r.reason === "MISSING_TRADE_PARAMS");
});

test("Validator rejects RR < 1.5", () => {
  // RR = 2/2 = 1.0 — too low
  const r = engine._validateDecision({
    action: "BUY", entry: 2345, stop_loss: 2343, take_profit: 2347,
    lot_size: 0.01, risk_percent: 1, mode: "scalping",
    market_state: "trending", volatility_regime: "normal",
    confidence: 70, reason: "TEST", cooldown_minutes: 10
  }, { atr: 5 });
  assert(r.action === "NO-TRADE");
  assert(r.reason.startsWith("RR_TOO_LOW"), "Expected RR_TOO_LOW, got: " + r.reason);
});

test("Validator passes valid BUY RR=1.625", () => {
  // RR = 13/8 = 1.625
  const r = engine._validateDecision({
    action: "BUY", entry: 2345, stop_loss: 2337, take_profit: 2358,
    lot_size: 0.02, risk_percent: 1, mode: "intraday_swing",
    market_state: "trending", volatility_regime: "normal",
    confidence: 75, reason: "EMA_BULL", cooldown_minutes: 30,
    invalidation: "2337", timestamp: new Date().toISOString()
  }, { atr: 8, news_risk: "LOW" });
  assert(r.action === "BUY", "Expected BUY, got: " + r.action);
  assert(r.validated === true);
});

test("Validator passes valid SELL RR=1.86", () => {
  // RR = 13/7 = 1.857
  const r = engine._validateDecision({
    action: "SELL", entry: 2345, stop_loss: 2352, take_profit: 2332,
    lot_size: 0.01, risk_percent: 1, mode: "scalping",
    market_state: "trending", volatility_regime: "normal",
    confidence: 68, reason: "EMA_BEAR", cooldown_minutes: 15,
    invalidation: "2352", timestamp: new Date().toISOString()
  }, { atr: 8, news_risk: "LOW" });
  assert(r.action === "SELL", "Expected SELL, got: " + r.action);
  assert(r.validated === true);
});

test("Prompt contains required fields and EMA rules", () => {
  const data = {
    timeframe: "M5", bid: 2345.50, ask: 2345.80, spread: 30,
    atr: 9.41, rsi: 51, ema20: 2346, ema50: 2344, ema200: 2340,
    macd: 3.45, macd_signal: 3.54, adx: 20.5,
    session: "asia", news_risk: "LOW", account_equity: 3000, open_trades: 0
  };
  const p = engine._buildPrompt(data);
  assert(p.includes("XAUUSD"));
  assert(p.includes("stop_loss"));
  assert(p.includes("take_profit"));
  assert(p.includes("EMA RULE"));
  assert(p.includes("ADX RULE"));
  assert(p.includes("BULLISH"), "Should detect BULLISH since EMA20 > EMA50");
});

test("Prompt detects BEARISH EMA direction", () => {
  const data = { bid: 2345.50, ask: 2345.80, spread: 30, atr: 9.41, timeframe: "M5", ema20: 2338, ema50: 2344 };
  const p = engine._buildPrompt(data);
  assert(p.includes("BEARISH"), "Should detect BEARISH since EMA20 < EMA50");
});

test("Stats update correctly", () => {
  const e2 = new TradingEngine(mockCerebras);
  e2._updateStats("BUY"); e2._updateStats("BUY");
  e2._updateStats("SELL"); e2._updateStats("NO-TRADE");
  assert(e2.stats.buyCount === 2);
  assert(e2.stats.sellCount === 1);
  assert(e2.stats.noTradeCount === 1);
});

console.log("\n" + "─".repeat(45));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
else console.log("All tests passed! 🎉");
