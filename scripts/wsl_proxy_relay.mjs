// Temporary WSL-to-Windows loopback relay for the user's existing local HTTP proxy.
// Start only for a Docker pull, then stop it. No proxy credentials are stored here.
import net from "node:net";

const bind = process.env.JWZZ_WSL_GATEWAY;
if (!bind || net.isIP(bind) !== 4) throw new Error("Set JWZZ_WSL_GATEWAY to the local vEthernet (WSL) IPv4 address");
const server = net.createServer(client => {
  const remote = client.remoteAddress?.replace(/^::ffff:/, "") ?? "";
  if (!remote.startsWith("172.") && !remote.startsWith("192.168.") && !remote.startsWith("10.")) {
    client.destroy(); return;
  }
  const upstream = net.connect({ host: "127.0.0.1", port: 7890 });
  client.pipe(upstream).pipe(client);
  client.on("error", () => upstream.destroy());
  upstream.on("error", () => client.destroy());
});
server.listen(7891, bind, () => process.stdout.write(`Temporary WSL proxy relay listening on ${bind}:7891\n`));
