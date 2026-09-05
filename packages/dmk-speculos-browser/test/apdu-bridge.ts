import { createServer, type Server } from 'node:http';

export type ApduBridge = {
  apduUrl: string;
  stop(): Promise<void>;
};

export async function startApduBridge(speculosApiUrl: string): Promise<ApduBridge> {
  const upstream = `${speculosApiUrl.replace(/\/$/, '')}/apdu`;
  const server = createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
    response.setHeader('access-control-allow-private-network', 'true');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/apdu') {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readBody(request);
      const upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      response.writeHead(upstreamResponse.status, {
        'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
      });
      response.end(Buffer.from(await upstreamResponse.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('APDU bridge did not bind a TCP port');
  return {
    apduUrl: `http://127.0.0.1:${address.port}/apdu`,
    stop: () => close(server),
  };
}

function readBody(request: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
