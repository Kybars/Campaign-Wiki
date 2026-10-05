import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

export function blockReplayNetwork() {
  let attempts = 0;
  const disabled = () => { attempts++; throw new Error("Network disabled for offline replay"); };
  globalThis.fetch = disabled;
  http.request = disabled as typeof http.request; http.get = disabled as typeof http.get;
  https.request = disabled as typeof https.request; https.get = disabled as typeof https.get;
  net.connect = disabled as typeof net.connect; net.createConnection = disabled as typeof net.createConnection;
  net.Socket.prototype.connect = disabled as typeof net.Socket.prototype.connect;
  tls.connect = disabled as typeof tls.connect;
  dgram.createSocket = disabled as typeof dgram.createSocket;
  syncBuiltinESMExports();
  return () => { if (attempts) throw new Error(`Offline replay attempted ${attempts} network calls`); return attempts; };
}
