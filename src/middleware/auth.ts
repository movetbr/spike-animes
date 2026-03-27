import { Context, Next } from 'hono';

/**
 * Middleware de autenticação por API Key.
 * 
 * O frontend envia: `x-api-key: SUA_CHAVE_SECRETA`
 * O backend verifica contra a variável de ambiente `API_SECRET_KEY`.
 * 
 * Rotas públicas (sem auth): GET /
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    // Rotas públicas que não precisam de autenticação
    const publicPaths = ['/'];
    if (publicPaths.includes(c.req.path)) {
      return next();
    }

    const apiKey = process.env.API_SECRET_KEY;
    
    // Se API_SECRET_KEY não está configurada, permitir acesso (desenvolvimento)
    if (!apiKey) {
      console.warn('[Auth] ⚠️ API_SECRET_KEY não configurada. Acesso liberado (modo dev).');
      return next();
    }

    // Verificar header x-api-key
    const clientKey = c.req.header('x-api-key');
    
    if (!clientKey) {
      return c.json({ 
        error: 'Unauthorized', 
        message: 'Header x-api-key é obrigatório.' 
      }, 401);
    }

    if (clientKey !== apiKey) {
      return c.json({ 
        error: 'Forbidden', 
        message: 'API Key inválida.' 
      }, 403);
    }

    return next();
  };
}
