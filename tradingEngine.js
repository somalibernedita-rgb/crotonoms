const { logger } = require("./logger");

/**
 * Autonomous Trading Engine — Robust Parser + RR Filter
 * Filter 1: Action valid
 * Filter 2: SL/TP/Entry mesti ada
 * Filter 3: RR >= 1.5
 * Parser: Robust — handle AI response yang ada text sebelum/selepas JSON
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
    const price = ((data.bid + data.ask) / 2).toFixed(3);
    const emaDir = data.ema20 && data.ema50
      ? (data.ema20 > data.ema50 ? "BULLISH (EMA20 > EMA50)" : "BEARISH (EMA20 < EMA50)")
      : "N/A";

    return `
You are an aggressive XAUUSD day trading AI. Your job is to find entries, not avoid them.

MARKET DATA — XAUUSD
═══════════════════════════════════════
Timestamp     : ${data.timestamp || new Date().toISOString()}
Timeframe     : ${data.timeframe}
Bid / Ask     : ${data.bid} / ${data.ask}
Current Price : ${price}
Spread (pts)  : ${data.spread}
ATR(14)       : ${data.atr}

INDICATORS
──────────
RSI(14)       : ${data.rsi || "N/A"}
EMA(20)       : ${data.ema20 || "N/A"}
EMA(50)       : ${data.ema50 || "N/A"}
EMA(200)      : ${data.ema200 || "N/A"}
EMA Direction : ${emaDir}
MACD          : ${data.macd || "N/A"}
MACD Signal   : ${data.macd_signal || "N/A"}
ADX           : ${data.adx || "N/A"}

CONTEXT
───────
Session       : ${data.session || "N/A"}
Volatility    : ${data.volatility || "N/A"}
News Risk     : ${data.news_risk || "LOW"}
Support       : ${data.support || "N/A"}
Resistance    : ${data.resistance || "N/A"}
Account Equity: ${data.account_equity || "N/A"}
Open Trades   : ${data.open_trades || 0}
Daily P&L     : ${data.daily_pnl || "N/A"}

═══════════════════════════════════════
DECISION RULES — FOLLOW STRICTLY:

1. EMA RULE (highest priority):
   - Price > EMA20 AND EMA20 > EMA50 → MUST return BUY
   - Price < EMA20 AND EMA20 < EMA50 → MUST return SELL

2. RSI RULE:
   - RSI > 55 → bias BUY
   - RSI < 45 → bias SELL
   - RSI 45-55 → follow EMA direction

3. ADX RULE:
   - ADX > 20 → market is trending, entry is valid
   - ADX 15-20 → entry still valid if EMA confirms
   - ADX < 15 → only then consider NO-TRADE

4. NO-TRADE is only allowed when ALL of these are true:
   - ADX < 15 (no trend at all)
   - RSI between 48-52 (completely neutral)
   - EMA20 and EMA50 are within 0.5 points of each other (flat)

5. "High volatility" and "unclear structure" are NOT valid reasons for NO-TRADE.
   Volatility = opportunity. Transitional markets still have a direction.

6. MACD conflict alone is NOT a reason for NO-TRADE. Use EMA as tiebreaker.

7. IMPORTANT — SL/TP RULES (DIRECTION IS CRITICAL):
   FOR BUY orders:
   - stop_loss  = entry MINUS 1.5x ATR  (SL must be BELOW entry)
   - take_profit = entry PLUS 2.5x ATR  (TP must be ABOVE entry)
   - Example: entry=4736, ATR=9 → SL=4736-(9x1.5)=4722.5, TP=4736+(9x2.5)=4758.5

   FOR SELL orders:
   - stop_loss  = entry PLUS 1.5x ATR   (SL must be ABOVE entry)
   - take_profit = entry MINUS 2.5x ATR (TP must be BELOW entry)
   - Example: entry=4736, ATR=9 → SL=4736+(9x1.5)=4749.5, TP=4736-(9x2.5)=4713.5

   FORBIDDEN — will be rejected by server:
   - SL == TP (same value)
   - SL == entry (same value)
   - BUY with SL above entry
   - SELL with SL below entry

8. lot_size: 0.01 to 0.05 for equity under $5000.

CRITICAL: Return ONLY raw JSON. No explanation. No markdown. No text before or after.
Start your response with { and end with }

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

  // ─── Decision Parser — ROBUST VERSION ───────────────────────────────────────
  _parseDecision(content, marketData) {
    // Step 1: Buang markdown fences
    let clean = content.replace(/```json|```/gi, "").trim();

    // Step 2: Cuba cari JSON object — ambil yang paling besar/lengkap
    // Cari dari { pertama hingga } terakhir
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
      logger.warn("No JSON braces found in AI response", { preview: clean.substring(0, 100) });
      return this._safetyFallback("PARSE_FAILED");
    }

    const jsonStr = clean.substring(firstBrace, lastBrace + 1);

    let decision;
    try {
      decision = JSON.parse(jsonStr);
    } catch (e) {
      // Step 3: Cuba repair JSON yang terpotong — tambah closing brace
      try {
        const repaired = jsonStr + "}";
        decision = JSON.parse(repaired);
        logger.warn("JSON repaired by adding closing brace");
      } catch (e2) {
        logger.warn("JSON parse failed even after repair", { error: e2.message, preview: jsonStr.substring(0, 150) });
        return this._safetyFallback("JSON_INVALID");
      }
    }

    return this._validateDecision(decision, marketData);
  }

  // ─── Decision Validator — 3 FILTER ──────────────────────────────────────────
  _validateDecision(decision, marketData) {

    // Filter 1: Action mesti valid — prevent system crash
    const action = decision.action?.toUpperCase();
    if (!["BUY", "SELL", "NO-TRADE"].includes(action)) {
      return this._safetyFallback("INVALID_ACTION");
    }

    // Filter 2: BUY/SELL mesti ada entry, SL, TP — dan semua mesti angka valid > 0
    if (action !== "NO-TRADE") {
      const e  = parseFloat(decision.entry);
      const sl = parseFloat(decision.stop_loss);
      const tp = parseFloat(decision.take_profit);

      if (!e || !sl || !tp || isNaN(e) || isNaN(sl) || isNaN(tp)) {
        return this._safetyFallback("MISSING_TRADE_PARAMS");
      }

      // Filter 2b: SL tidak boleh sama dengan entry (division by zero)
      if (Math.abs(e - sl) < 0.001) {
        logger.warn("SL equals entry", { entry: e, sl });
        return this._safetyFallback("SL_EQUALS_ENTRY");
      }

      // Filter 2c: SL tidak boleh sama dengan TP — ini penyebab MT5 error 10016
      if (Math.abs(sl - tp) < 0.001) {
        logger.warn("SL equals TP — MT5 invalid stops", { sl, tp });
        return this._safetyFallback("SL_EQUALS_TP");
      }

      // Filter 2d: Arah SL dan TP mesti betul
      // BUY  → SL di bawah entry, TP di atas entry
      // SELL → SL di atas entry,  TP di bawah entry
      if (action === "BUY") {
        if (sl >= e) {
          logger.warn("BUY: SL must be below entry", { entry: e, sl });
          return this._safetyFallback("SL_WRONG_SIDE_BUY");
        }
        if (tp <= e) {
          logger.warn("BUY: TP must be above entry", { entry: e, tp });
          return this._safetyFallback("TP_WRONG_SIDE_BUY");
        }
      }

      if (action === "SELL") {
        if (sl <= e) {
          logger.warn("SELL: SL must be above entry", { entry: e, sl });
          return this._safetyFallback("SL_WRONG_SIDE_SELL");
        }
        if (tp >= e) {
          logger.warn("SELL: TP must be below entry", { entry: e, tp });
          return this._safetyFallback("TP_WRONG_SIDE_SELL");
        }
      }

      // Filter 3: RR mesti >= 1.5 — sekarang aman dari division by zero
      const rr = Math.abs((tp - e) / (e - sl));

      if (!isFinite(rr) || isNaN(rr) || rr < 1.5) {
        logger.warn("RR below minimum or invalid", { rr: isFinite(rr) ? rr.toFixed(2) : rr });
        return this._safetyFallback(`RR_TOO_LOW:${isFinite(rr) ? rr.toFixed(2) : "invalid"}`);
      }

      // Patch nilai ke float bersih
      decision.entry      = e;
      decision.stop_loss  = sl;
      decision.take_profit = tp;
      decision.risk_reward = parseFloat(rr.toFixed(2));
    }

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
