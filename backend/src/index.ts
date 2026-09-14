import { Env, TelegramUpdate } from './types';
import { handleBotUpdate } from './handlers/bot';
import { handleApiRequest } from './handlers/api';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      try {
        const update = await request.json() as TelegramUpdate;
        return await handleBotUpdate(update, env);
      } catch (error) {
        console.error(`WEBHOOK_PARSE_ERROR: ${(error as Error).message}`);
        return new Response('BAD_REQUEST', { status: 400 });
      }
    }

    if (url.pathname.startsWith('/api/')) {
      const response = await handleApiRequest(request, env);
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }

    return new Response('Notigram Edge API is running.', { status: 200 });
  },
};