const { logger } = require("./logger");

/**
 * Autonomous Trading Engine — Minimal Filter Version
 * Hanya safety filter kritikal yang dipertahankan.
 * Biarkan Cerebras AI yang buat keputusan penuh.
 */
class TradingEngine {
  constructor(cerebras) {
    this.cerebras = cerebras;
    this.startTime = Date.now();
    this.stats = {
      totalRequests: 0,
      noTradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      errorCount: 0,
    };
  }

  // ─── Main Analysis ──────────────────────────────────────────────────────────
  async analyze(marketData) {
    this.stats.totalRequests++;

    const prompt = this._buildPrompt(marketData);
    let aiResponse;

    try {
      aiResponse = await this.cerebras.complete(prompt, {
        maxTokens: 1024,
        temperature: 0.05,
      });
    } catch (err) {
      this.stats.errorCount++;
      logger.error("Cerebras AI call failed", { error: err.message });
      return this._safetyFallback("AI_UNAVAILABLE");
    }

    const decision = this._parseDecision(aiResponse.content, marketData);
    this._updateStats(decision.action);

    return {
      ...decision,
      ai_tokens: aiResponse.tokens,
      raw_response: process.env.DEBUG_MODE === "true" ? aiResponse.content : undefined,
    };
  }

  // ─── Deep Analysis ──────────────────────────────────────────────────────────
  async deepAnalyze(marketData, depth = "standard") {
    const prompt = `
Perform a comprehensive ${depth} market structure analysis for XAUUSD.

Market Context:
${JSON.stringify(marketData, null, 2)}

Provide analysis covering:
1. MARKET_STATE: trending/ranging/transitional/chaotic
2. VOLATILITY_REGIME: low/normal/elevated/extreme
3. BIAS: bullish/bearish/neutral with confidence score (0-100)
4. KEY_LEVELS: support, resistance, and liquidity zones
5. RISK_ENVIRONMENT: safe/cautious/dangerous/forbidden
6. CONFLUENCE_FACTORS: list active confirming signals
7. INVALIDATION_ZONES: where current bias is structurally wrong

Output as strict JSON only.`.trim();

    const aiResponse = await this.cerebras.complete(prompt, {
      maxTokens: 2048,
      temperature: 0.1,
    });

    try {
      const clean = aiResponse.content.replace(/```json|```/g, "").trim();
      return JSON.parse(clean);
    } catch {
      return { raw_analysis: aiResponse.content, parse_error: true };
    }
  }

  // ─── Risk Assessment ────────────────────────────────────────────────────────
  async assessRisk(trade, accountInfo) {
    const prompt = `
Evaluate this trade's risk profile for XAUUSD:

Trade Parameters:
${JSON.stringify(trade, null, 2)}

Account Info:
${JSON.stringify(accountInfo, null, 2)}

Assess:
- Risk/Reward ratio adequacy
- Position size relative to account
- Stop loss structural validity
- Maximum adverse excursion estimate
- Overall risk verdict: ACCEPTABLE / MARGINAL / REJECT

Output strict JSON only.`.trim();

    const aiResponse = await this.cerebras.complete(prompt, {
      maxTokens: 512,
      temperature: 0.05,
    });

    try {
      const clean = aiResponse.content.replace(/```json|```/g, "").trim();
      return JSON.parse(clean);
    } catch {
      return { verdict: "REJECT", reason: "PARSE_ERROR", raw: aiResponse.content };
    }
  }

  // ─── Prompt Builder ─────────────────────────────────────────────────────────
  _buildPrompt(data) {
    return `
MARKET DATA SNAPSHOT — XAUUSD
═══════════════════════════════════════
Timestamp     : ${data.timestamp || new Date().toISOString()}
Timeframe     : ${data.timeframe}
Bid           : ${data.bid}
Ask           : ${data.ask}
Spread (pts)  : ${data.spread}
ATR(14)       : ${data.atr}
ATR Ratio     : ${data.atr_ratio || "N/A"}

PRICE STRUCTURE
───────────────
Current Price : ${((data.bid + data.ask) / 2).toFixed(3)}
High (session): ${data.session_high || "N/A"}
Low  (session): ${data.session_low || "N/A"}

TECHNICAL INDICATORS
────────────────────
RSI(14)       : ${data.rsi || "N/A"}
EMA(20)       : ${data.ema20 || "N/A"}
EMA(50)       : ${data.ema50 || "N/A"}
EMA(200)      : ${data.ema200 || "N/A"}
MACD          : ${data.macd || "N/A"}
MACD Signal   : ${data.macd_signal || "N/A"}
ADX           : ${data.adx || "N/A"}

MARKET CONDITIONS
─────────────────
Volatility    : ${data.volatility || "N/A"}
Session       : ${data.session || "N/A"}
News Risk     : ${data.news_risk || "LOW"}
Account Equity: ${data.account_equity || "N/A"}
Open Trades   : ${data.open_trades || 0}
Daily P&L     : ${data.daily_pnl || "N/A"}

KEY LEVELS
──────────
Nearest Support   : ${data.support || "N/A"}
Nearest Resistance: ${data.resistance || "N/A"}

═══════════════════════════════════════
You are an autonomous XAUUSD trading AI. Analyze the data above and return a trading decision.

RULES:
- Be decisive. If there is any directional signal, return BUY or SELL.
- Only return NO-TRADE if the market is completely sideways (ADX < 15) or news_risk is HIGH/EXTREME.
- Spread up to 500 points is normal for XAUUSD on Exness — ignore spread.
- Set stop_loss and take_profit based on ATR and key levels.
- Minimum risk/reward: 1.2
- lot_size: 0.01 to 0.05 for accounts under $5000.

Return ONLY this JSON, no explanation:

{
  "action": "BUY" | "SELL" | "NO-TRADE",
  "mode": "scalping" | "intraday_swing" | "no_trade",
  "market_state": "trending" | "ranging" | "transitional" | "chaotic",
  "volatility_regime": "low" | "normal" | "elevated" | "extreme",
  "entry": <number or null>,
  "stop_loss": <number or null>,
  "take_profit": <number or null>,
  "risk_reward": <number or null>,
  "lot_size": <number or null>,
  "risk_percent": <number or null>,
  "cooldown_minutes": <integer>,
  "confidence": <0-100>,
  "reason": "<concise reason>",
  "invalidation": "<price level>",
  "timestamp": "<ISO8601>"
}`.trim();
  }

  // ─── Decision Parser ────────────────────────────────────────────────────────
  _parseDecision(content, marketData) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("No JSON in AI response");
      return this._safetyFallback("PARSE_FAILED");
    }

    let decision;
    try {
      decision = JSON.parse(jsonMatch[0]);
    } catch (e) {
      logger.warn("JSON parse error", { error: e.message });
      return this._safetyFallback("JSON_INVALID");
    }

    return this._validateDecision(decision, marketData);
  }

  // ─── Decision Validator — HANYA 4 FILTER KRITIKAL ───────────────────────────
  _validateDecision(decision, marketData) {

    // Filter 1: Action mesti valid — tanpa ini sistem akan crash
    const action = decision.action?.toUpperCase();
    if (!["BUY", "SELL", "NO-TRADE"].includes(action)) {
      return this._safetyFallback("INVALID_ACTION");
    }

    // Filter 2: Berita HIGH/EXTREME — terlalu berbahaya untuk trade
    if (marketData.news_risk === "HIGH" || marketData.news_risk === "EXTREME") {
      return this._safetyFallback("NEWS_RISK_OVERRIDE");
    }

    // Filter 3: BUY/SELL mesti ada SL dan TP — tanpa ini EA tidak boleh execute
    if (action !== "NO-TRADE") {
      if (!decision.stop_loss || !decision.take_profit || !decision.entry) {
        return this._safetyFallback("MISSING_TRADE_PARAMS");
      }

      // Filter 4: Cap lot size — jangan sampai blow account
      if (decision.lot_size > 5.0) {
        decision.lot_size = 5.0;
        logger.warn("Lot size capped at 5.0");
      }
    }

    // Semua OK — teruskan keputusan AI tanpa halangan lain
    return {
      ...decision,
      action,
      timestamp: decision.timestamp || new Date().toISOString(),
      validated: true,
    };
  }

  // ─── Safety Fallback ────────────────────────────────────────────────────────
  _safetyFallback(reason) {
    return {
      action: "NO-TRADE",
      mode: "no_trade",
      market_state: "unknown",
      volatility_regime: "unknown",
      entry: null,
      stop_loss: null,
      take_profit: null,
      risk_reward: null,
      lot_size: null,
      risk_percent: null,
      cooldown_minutes: 15,
      confidence: 0,
      reason,
      invalidation: null,
      timestamp: new Date().toISOString(),
      validated: false,
      safety_override: true,
    };
  }

  // ─── Stats ──────────────────────────────────────────────────────────────────
  _updateStats(action) {
    if (action === "NO-TRADE") this.stats.noTradeCount++;
    else if (action === "BUY") this.stats.buyCount++;
    else if (action === "SELL") this.stats.sellCount++;
  }

  getStatus() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    return {
      status: "active",
      uptime_seconds: uptime,
      model: this.cerebras.getModel(),
      stats: this.stats,
      no_trade_rate:
        this.stats.totalRequests > 0
          ? ((this.stats.noTradeCount / this.stats.totalRequests) * 100).toFixed(1) + "%"
          : "0%",
    };
  }
}

module.exports = { TradingEngine };
