/**
 * Gemini Cookie Client — reverse-engineered Gemini Pro access via browser cookies.
 *
 * Uses __Secure-1PSID and __Secure-1PSIDTS session cookies instead of an API key.
 * Hits Gemini's internal BardFrontendService StreamGenerate endpoint directly.
 *
 * Usage:
 *   Set GEMINI_PSID and GEMINI_PSIDTS in .env (from gemini.google.com cookies)
 */

import { createLogger } from '../agent/logger.js';

const log = createLogger('GEMINI-COOKIE');

const BASE_URL = 'https://gemini.google.com';
const API_URL = `${BASE_URL}/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate`;

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
  'Host': 'gemini.google.com',
  'Origin': 'https://gemini.google.com',
  'Referer': 'https://gemini.google.com/',
  'X-Same-Domain': '1',
};

interface GeminiResponse {
  content?: string;
  conversation_id?: string;
  response_id?: string;
  choice_id?: string;
  error?: string;
}

export class GeminiCookieClient {
  private psid: string;
  private psidts: string;
  private atToken: string | null = null;
  private blLabel = 'boq_assistant-bard-web-server_20240319.10_p0';
  private conversationId = '';
  private responseId = '';
  private choiceId = '';
  private reqId: number;

  constructor(psid: string, psidts: string) {
    this.psid = psid;
    this.psidts = psidts;
    this.reqId = Math.floor(Math.random() * 900000) + 100000;
  }

  private cookieHeader(): string {
    return `__Secure-1PSID=${this.psid}; __Secure-1PSIDTS=${this.psidts}`;
  }

  private async fetchAtToken(): Promise<void> {
    const resp = await fetch(`${BASE_URL}/app`, {
      headers: { ...HEADERS, Cookie: this.cookieHeader() },
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch Gemini page. Status: ${resp.status}`);
    }

    const html = await resp.text();

    const atMatch = html.match(/SNlM0e":"(.*?)"/);
    if (!atMatch) {
      throw new Error('Could not find SNlM0e token — cookies may be expired or invalid.');
    }
    this.atToken = atMatch[1];

    const blMatch = html.match(/"cfb2h":"(.*?)"/);
    if (blMatch) {
      this.blLabel = blMatch[1];
    }
  }

  async ask(prompt: string, isRetry = false): Promise<GeminiResponse> {
    if (!this.atToken) {
      await this.fetchAtToken();
    }

    this.reqId += Math.floor(Math.random() * 4000) + 1000;

    const urlParams = new URLSearchParams({
      bl: this.blLabel,
      _reqid: String(this.reqId),
      rt: 'c',
    });

    const requestData = [
      [prompt, 0, null, null, null, null, 0],
      null,
      [this.conversationId, this.responseId, this.choiceId],
    ];

    const body = new URLSearchParams({
      'f.req': JSON.stringify([null, JSON.stringify(requestData)]),
      at: this.atToken!,
    });

    try {
      const resp = await fetch(`${API_URL}?${urlParams}`, {
        method: 'POST',
        headers: { ...HEADERS, Cookie: this.cookieHeader() },
        body: body.toString(),
        signal: AbortSignal.timeout(60000),
      });

      if ((resp.status === 401 || resp.status === 403) && !isRetry) {
        log.warn('Session potentially expired — refreshing at token');
        this.atToken = null;
        await this.fetchAtToken();
        return this.ask(prompt, true);
      }

      if (!resp.ok) {
        return { error: `Request failed with status ${resp.status}` };
      }

      const raw = await resp.text();
      return this.parseResponse(raw);
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        return { error: 'Connection to Gemini timed out.' };
      }
      return { error: `Connection error: ${String(err)}` };
    }
  }

  private parseResponse(rawText: string): GeminiResponse {
    try {
      const clean = rawText.replace(/^\s*\)\]\}'\s*\n?/, '');
      const chunks = clean.split(/\d+\r?\n/);
      const result: GeminiResponse = { content: '', conversation_id: this.conversationId };

      for (const chunk of chunks) {
        if (!chunk.trim()) continue;

        let data: any;
        try {
          data = JSON.parse(chunk);
        } catch {
          continue;
        }

        if (!Array.isArray(data)) continue;

        for (const item of data) {
          if (!Array.isArray(item) || item.length === 0) continue;

          // Error signals
          if (item[0] === 'e') {
            const code = item[item.length - 1] ?? 'unknown';
            return { error: `Google backend error (${code}) — session may be expired or IP blocked.` };
          }

          // Main response wrapper
          if (item[0] === 'wrb.fr' && item[2] != null) {
            let inner: any;
            try { inner = JSON.parse(item[2]); } catch { continue; }

            if (Array.isArray(inner?.[1])) {
              this.conversationId = inner[1][0] ?? '';
              this.responseId = inner[1][1] ?? '';
            }

            if (Array.isArray(inner?.[4]?.[0])) {
              const choice = inner[4][0];
              this.choiceId = choice[0] ?? '';
              result.content = choice[1]?.[0] ?? '';
              result.conversation_id = this.conversationId;
              result.response_id = this.responseId;
              result.choice_id = this.choiceId;
            }
          }

          // Alternative identifier
          if (item[0] === 'w69eS' && item[1]) {
            result.content = item[1];
            const meta = item[2];
            if (Array.isArray(meta)) {
              this.conversationId = meta[0] ?? '';
              this.responseId = meta[1] ?? '';
              this.choiceId = meta[2]?.[0]?.[0] ?? '';
              result.conversation_id = this.conversationId;
              result.response_id = this.responseId;
              result.choice_id = this.choiceId;
            }
          }
        }
      }

      if (result.content) return result;

      return { error: 'Could not parse Gemini response — format may have changed.' };
    } catch (err) {
      return { error: `Parse exception: ${String(err)}` };
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _client: GeminiCookieClient | null = null;

export function getGeminiCookieClient(psid: string, psidts: string): GeminiCookieClient {
  if (!_client) {
    _client = new GeminiCookieClient(psid, psidts);
  }
  return _client;
}

export async function askGeminiWithCookies(
  prompt: string,
  psid: string,
  psidts: string,
): Promise<string | null> {
  try {
    const client = getGeminiCookieClient(psid, psidts);
    const result = await client.ask(prompt);
    if (result.error) {
      log.warn(`Gemini cookie client error: ${result.error}`);
      return null;
    }
    return result.content ?? null;
  } catch (err) {
    log.warn(`Gemini cookie client threw: ${err}`);
    return null;
  }
}
