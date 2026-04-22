# 🤖 XAUUSD Autonomous Trading Server

> **Cerebras llama3.1-8b** · Node.js · Railway · GitHub Actions

An autonomous AI trading decision engine for XAUUSD (Gold/USD), designed to interface with MetaTrader 5 Expert Advisors. Capital preservation is the primary directive — the AI only approves trades when structural confluence is confirmed.

---

## 🏗️ Architecture

```
MT5 EA  ──POST──►  /api/decision  ──►  TradingEngine  ──►  Cerebras AI
                                              │                    │
                                        Validation            llama3.1-8b
                                        Safety Checks         (low temp)
                                              │
                                        JSON Decision
                                        BUY / SELL / NO-TRADE
```

---

## 📁 Project Structure

```
trading-server/
├── server.js           # Express server, routes, middleware
├── cerebras.js         # Cerebras API client (llama3.1-8b)
├── tradingEngine.js    # Autonomous decision logic + validation
├── logger.js           # Structured JSON logging
├── tests/
│   └── test.js         # Unit tests (no external deps)
├── .github/
│   └── workflows/
│       └── deploy.yml  # CI/CD → Railway
├── railway.toml        # Railway deployment config
├── package.json
└── .env.example
```

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd trading-server
npm install
```

### 2. Set Environment Variables

```bash
cp .env.example .env
# Edit .env and add your CEREBRAS_API_KEY
```

Get your Cerebras API key at: https://cloud.cerebras.ai

### 3. Run Locally

```bash
npm start
# or for development with auto-restart:
npm run dev
```

### 4. Test

```bash
npm test
```

---

## ☁️ Deploy to Railway

### Option A — Railway CLI (recommended)

```bash
npm install -g @railway/cli
railway login
railway init          # link to a Railway project
railway variables set CEREBRAS_API_KEY=your_key_here
railway up
```

### Option B — GitHub Auto-Deploy

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repository
4. Add environment variables in Railway dashboard:
   - `CEREBRAS_API_KEY` = your key
5. Railway auto-deploys on every push to `main`

### Required GitHub Secrets (for CI/CD)

| Secret | Value |
|---|---|
| `RAILWAY_TOKEN` | From Railway → Account Settings → Tokens |
| `CEREBRAS_API_KEY` | From cloud.cerebras.ai |
| `RAILWAY_PUBLIC_URL` | Your Railway app URL (for health checks) |

---

## 📡 API Reference

### `GET /health`
Server health check. Used by Railway for uptime monitoring.

**Response:**
```json
{
  "status": "operational",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600
}
```

---

### `POST /api/decision`
Main endpoint — receives market data, returns AI trading decision.

**Request Body:**
```json
{
  "symbol": "XAUUSD",
  "timeframe": "M15",
  "bid": 2345.50,
  "ask": 2345.80,
  "spread": 30,
  "atr": 8.5,
  "atr_ratio": 1.2,
  "rsi": 58.3,
  "ema20": 2340.10,
  "ema50": 2330.50,
  "ema200": 2300.00,
  "macd": 2.3,
  "macd_signal": 1.8,
  "adx": 28.5,
  "volatility": "normal",
  "session": "london",
  "news_risk": "LOW",
  "support": 2330.00,
  "resistance": 2360.00,
  "account_equity": 10000,
  "open_trades": 0,
  "daily_pnl": 45.50
}
```

**Response — Trade:**
```json
{
  "action": "BUY",
  "mode": "intraday_swing",
  "market_state": "trending",
  "volatility_regime": "normal",
  "entry": 2345.80,
  "stop_loss": 2338.50,
  "take_profit": 2360.00,
  "risk_reward": 1.95,
  "lot_size": 0.10,
  "risk_percent": 1.0,
  "cooldown_minutes": 30,
  "confidence": 74,
  "reason": "EMA_CONFLUENCE_BULLISH_STRUCTURE",
  "invalidation": "2338.00",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "meta": {
    "latency_ms": 850,
    "model": "llama3.1-8b"
  }
}
```

**Response — No Trade:**
```json
{
  "action": "NO-TRADE",
  "mode": "no_trade",
  "reason": "VOLATILITY_ELEVATED_STRUCTURE_UNCLEAR",
  "confidence": 0,
  "cooldown_minutes": 15
}
```

---

### `POST /api/analyze`
Deep market structure analysis.

```json
{
  "marketData": { ... },
  "depth": "standard"
}
```

---

### `GET /api/status`
Engine stats and health.

---

## 🛡️ Safety Rules (Hard-coded)

| Condition | Response |
|---|---|
| `news_risk: HIGH/EXTREME` | Force NO-TRADE |
| `spread > atr × 0.3` | Force NO-TRADE |
| Risk/Reward `< 1.5` | Force NO-TRADE |
| `lot_size > 5.0` | Cap to 5.0 |
| `risk_percent > 2.0` | Cap to 2.0 |
| AI returns invalid JSON | Force NO-TRADE |
| Cerebras unavailable | Force NO-TRADE |

---

## 🔌 MetaTrader 5 Integration

In your MQL5 EA, call the server via HTTP:

```mql5
string url = "https://your-app.railway.app/api/decision";
string body = BuildJsonPayload();  // serialize market data

string headers = "Content-Type: application/json\r\n";
char postData[], resultData[];
StringToCharArray(body, postData);

int res = WebRequest("POST", url, headers, 5000, postData, resultData, headers);
string response = CharArrayToString(resultData);

// Parse action from JSON response
// BUY / SELL / NO-TRADE
```

---

## 📊 Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CEREBRAS_API_KEY` | ✅ | Cerebras cloud API key |
| `PORT` | ❌ | Server port (default: 3000) |
| `NODE_ENV` | ❌ | `production` or `development` |
| `LOG_LEVEL` | ❌ | `debug`, `info`, `warn`, `error` |
| `ALLOWED_ORIGINS` | ❌ | CORS origins (comma-separated) |
| `DEBUG_MODE` | ❌ | Include raw AI response in output |

---

## ⚠️ Disclaimer

This software is for **educational and research purposes only**. It is not financial advice. Trading carries significant risk of loss. Always test in a demo environment before considering any live deployment.
