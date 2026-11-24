import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import {
  handleDiscordCallback,
  handleDiscordConfig,
  handleDiscordUrl,
  handleEncryptHint,
  handleHealth,
  handleLoginFailure,
  handleLoginGuard,
  handleLoginSuccess,
  handleOtpSend,
  handleOtpVerify,
  handleResolveLogin,
} from './shared/backend/authHandlers.ts';
import type { BackendRequest, BackendResponse } from './shared/backend/types.ts';

function getClientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function toBackendRequest(req: express.Request): BackendRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : val;
  }

  const query: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(req.query)) {
    if (typeof val === 'string') {
      query[key] = val;
    } else if (Array.isArray(val) && typeof val[0] === 'string') {
      query[key] = val[0];
    }
  }

  const body =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : {};

  return {
    method: req.method,
    headers,
    query,
    body,
    clientIp: getClientIp(req),
    protocol: req.protocol || 'https',
    host: (headers['x-forwarded-host'] || req.get('host') || 'localhost:3000').toString(),
  };
}

function sendExpressResponse(res: express.Response, result: BackendResponse): void {
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  if (result.contentType === 'html') {
    res
      .status(result.status)
      .type('html')
      .send(typeof result.body === 'string' ? result.body : String(result.body ?? ''));
    return;
  }
  res.status(result.status).json(result.body ?? {});
}

function mountHandler(
  handler: (req: BackendRequest) => Promise<BackendResponse>
): express.RequestHandler {
  return async (req, res, next) => {
    try {
      const result = await handler(toBackendRequest(req));
      sendExpressResponse(res, result);
    } catch (err) {
      next(err);
    }
  };
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.set('trust proxy', true);
  app.use(express.json({ limit: '64kb' }));

  app.get(['/health', '/api/health'], mountHandler(() => handleHealth()));

  app.get('/api/oauth/discord/config', mountHandler(handleDiscordConfig));
  app.get('/api/oauth/discord/url', mountHandler(handleDiscordUrl));
  app.get(['/auth/discord/callback', '/auth/discord/callback/'], mountHandler(handleDiscordCallback));

  app.post('/api/auth/otp/send', mountHandler(handleOtpSend));
  app.post('/api/auth/otp/verify', mountHandler(handleOtpVerify));

  app.post('/api/auth/login-guard', mountHandler(handleLoginGuard));
  app.post('/api/auth/login-failure', mountHandler(handleLoginFailure));
  app.post('/api/auth/login-success', mountHandler(handleLoginSuccess));

  app.post('/api/auth/encrypt-hint', mountHandler(handleEncryptHint));
  app.post('/api/auth/resolve-login', mountHandler(handleResolveLogin));

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await import('vite');
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    const viteServer = await vite.createServer({
      server: {
        middlewareMode: true,
        hmr: hmrEnabled,
        ws: hmrEnabled ? { server: httpServer } : false,
      },
      appType: 'spa',
    });
    if (!hmrEnabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await viteServer.transformRequest('/@vite/client');
          if (!result) {
            next();
            return;
          }
          const patched = result.code
            .replace('await wsTransport.connect(handlers);', 'return;')
            .replace(
              'ws.send(JSON.stringify(data));',
              'if (ws && ws.readyState === 1) ws.send(JSON.stringify(data));'
            );
          res.type('application/javascript').send(patched);
        } catch (err) {
          next(err);
        }
      });
    }
    app.use(viteServer.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Clerk server running on http://0.0.0.0:${port}`);
  });
}

void startServer();
