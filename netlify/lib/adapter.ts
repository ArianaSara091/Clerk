import type { Context } from '@netlify/functions';
import type { BackendRequest, BackendResponse } from '../../shared/backend/types.ts';

const MAX_JSON_BODY_BYTES = 64 * 1024;

function headersToRecord(headers: Headers): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function resolveClientIp(req: Request, context: Context): string {
  if (context.ip) return context.ip;
  const nfIp = req.headers.get('x-nf-client-connection-ip');
  if (nfIp) return nfIp.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

function sendBackendResponse(res: BackendResponse): Response {
  const headers = new Headers(res.headers);
  if (res.contentType === 'html') {
    headers.set('Content-Type', 'text/html; charset=utf-8');
    headers.set('Cache-Control', 'no-store');
    return new Response(typeof res.body === 'string' ? res.body : String(res.body ?? ''), {
      status: res.status,
      headers,
    });
  }

  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(res.body ?? {}), {
    status: res.status,
    headers,
  });
}

export async function handleNetlifyRequest(
  req: Request,
  context: Context,
  expectedMethod: 'GET' | 'POST',
  handler: (backendReq: BackendRequest) => Promise<BackendResponse>
): Promise<Response> {
  if (req.method !== expectedMethod) {
    return new Response(
      JSON.stringify({ error: `Method ${req.method} not allowed.` }),
      {
        status: 405,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Allow: expectedMethod,
        },
      }
    );
  }

  const parsedUrl = new URL(req.url);
  const query: Record<string, string | undefined> = {};
  parsedUrl.searchParams.forEach((value, key) => {
    query[key] = value;
  });

  let body: Record<string, unknown> = {};
  if (expectedMethod === 'POST') {
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_JSON_BODY_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Request payload exceeds 64KB limit.' }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      );
    }
    if (rawText.trim().length > 0) {
      try {
        const parsed = JSON.parse(rawText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        return new Response(
          JSON.stringify({ error: 'Invalid JSON request body.' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      }
    }
  }

  const headers = headersToRecord(req.headers);
  const protocol = parsedUrl.protocol.replace(/:$/, '') || 'https';
  const host = headers['x-forwarded-host'] || headers['host'] || parsedUrl.host;

  const backendReq: BackendRequest = {
    method: req.method,
    headers,
    query,
    body,
    clientIp: resolveClientIp(req, context),
    protocol,
    host,
  };

  try {
    const response = await handler(backendReq);
    return sendBackendResponse(response);
  } catch (err) {
    console.error('Netlify function error:', err instanceof Error ? err.message : 'Unknown error');
    return new Response(
      JSON.stringify({ error: 'Server error while processing authentication request.' }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}
