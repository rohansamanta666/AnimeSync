import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import app from './src/app';
import config from './src/config';

const PORT = Number(process.env.PORT) || config.port || 5000;
const HOST = process.env.HOST || '0.0.0.0';

async function readBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const protocol = 'http';
    const hostHeader = req.headers.host || `127.0.0.1:${PORT}`;
    const url = `${protocol}://${hostHeader}${req.url || '/'}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v);
      } else {
        headers.set(key, value);
      }
    }

    const body = await readBody(req);
    const requestInit: RequestInit = {
      method: req.method || 'GET',
      headers,
    };
    if (body !== undefined) {
      requestInit.body = Buffer.from(body);
    }

    const webRequest = new Request(url, requestInit);
    const webResponse = await app.fetch(webRequest);

    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (webResponse.body) {
      const arrayBuffer = await webResponse.arrayBuffer();
      res.end(Buffer.from(arrayBuffer));
    } else {
      res.end();
    }
  } catch (error) {
    console.error('Node HTTP bridge error:', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
    }
    res.end(JSON.stringify({ success: false, message: 'Internal server error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`anime-provider Node server running at http://${HOST}:${PORT}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
