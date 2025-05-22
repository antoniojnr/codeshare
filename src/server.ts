// src/server.ts
import * as http from "http";
import * as ws from "ws";
import * as path from "path";
import * as fs from "fs";
import * as mime from "mime-types";
import * as os from "os";

let server: http.Server | null = null;
let wss: ws.Server | null = null;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

function broadcast(text: string) {
  if (!wss) {
    return;
  }
  console.info(`[Codeshare] broadcasting to ${wss.clients.size} clients.`);
  wss.clients.forEach(
    (client: ws.WebSocket) =>
      client.readyState === ws.WebSocket.OPEN && client.send(text)
  );
}

function broadcastFile(fileData: {
  filename: string;
  content: string;
  language: string;
}) {
  const json = JSON.stringify(fileData);

  if (!wss) return;
  wss.clients.forEach(
    (client: ws.WebSocket) =>
      client.readyState === ws.WebSocket.OPEN && client.send(json)
  );
}

export function getLocalIPAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const ifaceDetails of iface) {
      if (ifaceDetails.family === "IPv4" && !ifaceDetails.internal) {
        return ifaceDetails.address;
      }
    }
  }

  return "localhost";
}

export function isServerRunning() {
  return server !== null;
}

export function stopServer() {
  if (wss) {
    wss.clients.forEach((client) => client.terminate());
    wss.close();
    wss = null;
  }
  if (server) {
    server.close();
    server = null;
  }
  console.log("Servidor encerrado.");
}

export function startServer(port = 3000) {
  if (server && wss) return { broadcast, ip: getLocalIPAddress() };

  server = http.createServer((req, res) => {
    const file = req.url === "/" ? "/index.html" : req.url!;
    const filePath = path.join(PUBLIC_DIR, file);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        const contentType = mime.lookup(filePath) || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
      }
    });
  });

  const ip = getLocalIPAddress();

  server.listen(port, () => {
    console.log(`Servidor iniciado em http://${ip}:${port}`);
  });
  wss = new ws.Server({ server });
  return { broadcast, ip };
}
