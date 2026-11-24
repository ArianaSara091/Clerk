export interface BackendRequest {
  method: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body: Record<string, unknown>;
  clientIp: string;
  protocol: string;
  host: string;
}

export interface BackendResponse {
  status: number;
  headers?: Record<string, string>;
  contentType?: 'json' | 'html';
  body: unknown;
}

export class BackendConfigError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BackendConfigError';
    this.status = status;
  }
}

export interface OtpChallenge {
  challengeId: string;
  email: string;
  purpose: 'signup' | '2fa';
  salt: string;
  codeHash: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: number;
  createdAt: number;
}

export interface DiscordOAuthState {
  mode: 'login' | 'link';
  origin: string;
  createdAt: number;
}
