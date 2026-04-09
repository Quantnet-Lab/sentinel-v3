import 'dotenv/config';

export const config = {
  // ── Identity ──────────────────────────────────────────────────────────────
  agentName: process.env.AGENT_NAME || 'Sentinel',
  agentDescription: process.env.AGENT_DESCRIPTION || 'Institutional SMC trading agent with adaptive trust governance',
  agentId: process.env.AGENT_ID ? parseInt(process.env.AGENT_ID) : null,
  walletAddress: process.env.WALLET_ADDRESS || '',

  // ── Wallet / Signing ──────────────────────────────────────────────────────
  privateKey: process.env.PRIVATE_KEY || '',
  agentWalletPrivateKey: process.env.AGENT_WALLET_PRIVATE_KEY || '',

  // ── Network ───────────────────────────────────────────────────────────────
  rpcUrl: process.env.RPC_URL || 'https://1rpc.io/sepolia',
  chainId: parseInt(process.env.CHAIN_ID || '11155111'),

  // ── ERC-8004 Contracts (Sepolia) ──────────────────────────────────────────
  agentRegistryAddress:    process.env.AGENT_REGISTRY_ADDRESS    || '0x97b07dDc405B0c28B17559aFFE63BdB3632d0ca3',
  hackathonVaultAddress:   process.env.HACKATHON_VAULT_ADDRESS   || '0x0E7CD8ef9743FEcf94f9103033a044caBD45fC90',
  riskRouterAddress:       process.env.RISK_ROUTER_ADDRESS       || '0xd6A6952545FF6E6E6681c2d15C59f9EB8F40FdBC',
  reputationRegistry:      process.env.REPUTATION_REGISTRY_ADDRESS || '0x423a9904e39537a9997fbaF0f220d79D7d545763',
  validationRegistry:      process.env.VALIDATION_REGISTRY_ADDRESS || '0x92bF63E5C7Ac6980f237a7164Ab413BE226187F1',

  // ── IPFS ──────────────────────────────────────────────────────────────────
  pinataJwt:     process.env.PINATA_JWT || '',
  pinataGateway: process.env.PINATA_GATEWAY || 'https://ipfs.io/ipfs',

  // ── AI / LLM ──────────────────────────────────────────────────────────────
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  groqApiKey:      process.env.GROQ_API_KEY || '',
  geminiApiKey:    process.env.GEMINI_API_KEY || '',
  geminiPsid:      process.env.GEMINI_PSID || '',
  geminiPsidts:    process.env.GEMINI_PSIDTS || '',
  openaiApiKey:    process.env.OPENAI_API_KEY || '',
  sageEnabled:     process.env.SAGE_ENABLED !== 'false',
  sageMinOutcomes: parseInt(process.env.SAGE_MIN_OUTCOMES || '5'),

  // ── Data ──────────────────────────────────────────────────────────────────
  prismApiKey:        process.env.PRISM_API_KEY || '',
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY || '',
  dataSource:         process.env.DATA_SOURCE || 'live',

  // ── Kraken ────────────────────────────────────────────────────────────────
  krakenApiKey:    process.env.KRAKEN_API_KEY || '',
  krakenApiSecret: process.env.KRAKEN_API_SECRET || '',
  krakenCliPath:   process.env.KRAKEN_CLI_PATH || 'kraken',
  executionMode:   (process.env.EXECUTION_MODE || 'paper') as 'paper' | 'live' | 'disabled',

  // ── Trading ───────────────────────────────────────────────────────────────
  symbols:          (process.env.TRADING_SYMBOLS || 'BTCUSD,ETHUSD,SOLUSD').split(',').map(s => s.trim()),
  initialCapital:   parseFloat(process.env.INITIAL_CAPITAL || '10000'),
  candleInterval:   parseInt(process.env.CANDLE_INTERVAL || '1'),
  maxPositionPct:   parseFloat(process.env.MAX_POSITION_PCT || '5') / 100,
  maxDailyLossPct:  parseFloat(process.env.MAX_DAILY_LOSS_PCT || '3') / 100,
  maxDrawdownPct:   parseFloat(process.env.MAX_DRAWDOWN_PCT || '10') / 100,
  maxPositions:     parseInt(process.env.MAX_POSITIONS || '5'),
  minTradeIntervalMs: 60_000,

  // ── Strategy ──────────────────────────────────────────────────────────────
  strategy: {
    atrPeriod:            14,
    rsiPeriod:            14,
    emaFastPeriod:        12,
    emaSlowPeriod:        26,
    macdSignalPeriod:     9,
    bbPeriod:             20,
    bbStdDev:             2.0,
    stopLossAtrMultiple:  2.0,
    takeProfitAtrMultiple: 3.0,
    minConfidence:        parseFloat(process.env.MIN_CONFIDENCE || '0.4'),
  },

  // ── Mandate / Governance ──────────────────────────────────────────────────
  tradingPair:                process.env.TRADING_PAIR || 'BTCUSD',
  allowedAssets:              (process.env.ALLOWED_ASSETS || 'BTC,ETH,SOL').split(',').map(s => s.trim()),
  allowedProtocols:           (process.env.ALLOWED_PROTOCOLS || 'kraken,uniswap').split(',').map(s => s.trim()),
  restrictedAssets:           (process.env.RESTRICTED_ASSETS || '').split(',').map(s => s.trim()).filter(Boolean),
  restrictedProtocols:        (process.env.RESTRICTED_PROTOCOLS || '').split(',').map(s => s.trim()).filter(Boolean),
  requireHumanApprovalAboveUsd: parseFloat(process.env.REQUIRE_HUMAN_APPROVAL_USD || '50000'),
  validatorAddress:           process.env.VALIDATOR_ADDRESS || '',
  preferredReviewerAddresses: (process.env.PREFERRED_REVIEWER_ADDRESSES || '').split(',').map(s => s.trim()).filter(Boolean),

  // ── Dashboard / MCP ───────────────────────────────────────────────────────
  dashboardPort: parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3000'),
  mcpPort:       parseInt(process.env.MCP_PORT || '3001'),
  dashboardUrl:  process.env.DASHBOARD_URL || 'http://localhost:3000',

  // ── Test / Dev ────────────────────────────────────────────────────────────
  testMode: process.env.TEST_MODE === 'true',
} as const;

export type Config = typeof config;
