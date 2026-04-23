const https = require("https");

const SYSTEM_PROMPT = `You are an autonomous trading intelligence for XAUUSD MetaTrader 5.
You trade to survive, adapt, and compound safely. Capital preservation is paramount.

CRITICAL OUTPUT RULE:
- You MUST respond with RAW JSON only
- Do NOT include any text, explanation, markdown, or code fences
- Do NOT write anything before { or after }
- Your entire response must be valid JSON starting with { and ending with }
- null values are allowed for numeric fields when NO-TRADE

Your responsibilities:
- Classify market state and volatility regime
- Decide if trading is permitted (BUY/SELL) or forbidden (NO-TRADE)
- Select mode: scalping, intraday_swing, or no_trade
- Define entry, stop_loss, take_profit using ATR-based placement
- Enforce risk control: SL = 1.5x ATR, TP = minimum 2.0x ATR from entry

Rules:
- Capital preservation overrides all opportunities
- Enter only when EMA + RSI + ADX confluence is present
- NO-TRADE only when ADX < 15 AND RSI 48-52 AND EMA flat
- Volatility is opportunity, not a reason to avoid trades`;

class CerebrasClient {
  constructor() {
    this.apiKey = process.env.CEREBRAS_API_KEY;
    this.model = "llama3.1-8b";
    this.baseUrl = "api.cerebras.ai";
    this.maxRetries = 3;
    this.timeout = 30000;

    if (!this.apiKey) {
      console.warn("⚠️  CEREBRAS_API_KEY not set — AI calls will fail");
    }
  }

  async complete(userMessage, options = {}) {
    const payload = {
      model: this.model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature ?? 0.05,
      top_p: options.topP ?? 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    };

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this._request(payload);
        return this._parseResponse(response);
      } catch (err) {
        if (attempt === this.maxRetries) throw err;
        const backoff = Math.pow(2, attempt) * 500;
        await this._sleep(backoff);
      }
    }
  }

  _request(payload) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(payload);
      const options = {
        hostname: this.baseUrl,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: this.timeout,
      };

      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200) {
              reject(new Error(`Cerebras API error ${res.statusCode}: ${JSON.stringify(parsed)}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Failed to parse Cerebras response: ${e.message}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Cerebras API request timed out"));
      });

      req.write(body);
      req.end();
    });
  }

  _parseResponse(response) {
    const content = response?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty response from Cerebras");

    const usage = response.usage || {};
    return {
      content: content.trim(),
      tokens: {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0,
      },
      model: response.model,
      finishReason: response.choices?.[0]?.finish_reason,
    };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getModel() {
    return this.model;
  }
}

module.exports = { CerebrasClient, SYSTEM_PROMPT };
