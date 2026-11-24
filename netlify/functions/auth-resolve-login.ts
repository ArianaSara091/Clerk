import type { Context } from '@netlify/functions';
import { handleResolveLogin } from '../../shared/backend/authHandlers.ts';
import { handleNetlifyRequest } from '../lib/adapter.ts';

export default async function handler(req: Request, context: Context): Promise<Response> {
  return handleNetlifyRequest(req, context, 'POST', handleResolveLogin);
}
