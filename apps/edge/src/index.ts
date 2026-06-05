import { handleRequest, type Env } from './router';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
};
