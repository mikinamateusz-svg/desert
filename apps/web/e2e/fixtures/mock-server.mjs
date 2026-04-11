import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dirname, 'stations.json'), 'utf-8'));

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url?.startsWith('/v1/stations/nearby')) {
    res.end(JSON.stringify(data.stations));
    return;
  }

  if (req.url?.startsWith('/v1/prices/nearby')) {
    res.end(JSON.stringify(data.prices));
    return;
  }

  // Single station by ID
  const match = req.url?.match(/^\/v1\/stations\/(.+)/);
  if (match) {
    const station = data.stations.find(s => s.id === match[1]);
    if (station) { res.end(JSON.stringify(station)); return; }
    res.writeHead(404);
    res.end('{}');
    return;
  }

  res.writeHead(404);
  res.end('{}');
});

server.listen(4444, () => console.log('Mock API running on :4444'));
