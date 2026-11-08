// Local-only fault injection. Never forwards the normal application's ports.
import net from 'node:net';
import http from 'node:http';
const services = {
  mysql: { listen: 15432, target: 3306, down: false, sockets: new Set() },
  redis: { listen: 16380, target: 16379, down: false, sockets: new Set() },
};
for (const [name, service] of Object.entries(services)) {
  net.createServer(client => {
    if (service.down) { client.destroy(); return; }
    const upstream = net.connect(service.target, '127.0.0.1');
    service.sockets.add(client); service.sockets.add(upstream);
    client.pipe(upstream); upstream.pipe(client);
    const close = () => { client.destroy(); upstream.destroy(); service.sockets.delete(client); service.sockets.delete(upstream); };
    client.on('error', close); upstream.on('error', close); client.on('close', close); upstream.on('close', close);
  }).listen(service.listen, '127.0.0.1', () => console.log(`${name} proxy listening ${service.listen}`));
}
http.createServer((req, res) => {
  const match = /^\/(mysql|redis)\/(up|down)$/.exec(req.url ?? '');
  if (req.method === 'POST' && match) {
    const service = services[match[1]];
    service.down = match[2] === 'down';
    if (service.down) for (const socket of service.sockets) socket.destroy();
    console.log(`${new Date().toISOString()} ${match[1]} ${match[2]}`);
  } else if (req.url !== '/state') { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(Object.fromEntries(Object.entries(services).map(([name, service]) => [name, { down: service.down, sockets: service.sockets.size }]))));
}).listen(18090, '127.0.0.1');
