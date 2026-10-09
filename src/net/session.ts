import Peer, { type DataConnection } from 'peerjs';
import type { BoardSnapshot, Difficulty } from '../game/game';

export const PROTOCOL_VERSION = 1;

export type Msg =
  | { t: 'hello'; v: number }
  /** host -> guest: (re)start the match with a shared seed */
  | { t: 'start'; seed: number; difficulty: Difficulty }
  /** this player has chosen for `level` and waits for the wave */
  | { t: 'ready'; level: number }
  | { t: 'snap'; s: BoardSnapshot };

export type SessionStatus = 'idle' | 'hosting' | 'connecting' | 'connected' | 'closed' | 'error';

const ID_PREFIX = 'gemtd-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** One peer-to-peer connection via PeerJS (public signalling server, WebRTC data channel). */
export class Session {
  status: SessionStatus = 'idle';
  role: 'host' | 'guest' | null = null;
  code = '';
  error = '';
  onMessage: (m: Msg) => void = () => {};
  onConnected: () => void = () => {};
  onClosed: () => void = () => {};

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;

  host(attempt = 0) {
    this.reset();
    this.role = 'host';
    this.code = makeCode();
    this.status = 'hosting';
    const peer = new Peer(ID_PREFIX + this.code);
    this.peer = peer;
    peer.on('connection', (c) => {
      if (this.conn) {
        c.on('open', () => c.close()); // room is full
        return;
      }
      this.attach(c);
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && attempt < 3) this.host(attempt + 1);
      else this.fail(e.message);
    });
  }

  join(code: string) {
    this.reset();
    this.role = 'guest';
    this.code = code.trim().toUpperCase();
    this.status = 'connecting';
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', () => this.attach(peer.connect(ID_PREFIX + this.code, { reliable: true })));
    peer.on('error', (e) => this.fail(e.type === 'peer-unavailable' ? `Room ${this.code} not found` : e.message));
  }

  send(m: Msg) {
    if (this.conn?.open) this.conn.send(m);
  }

  get connected() {
    return this.status === 'connected';
  }

  leave() {
    this.reset();
    this.status = 'idle';
    this.role = null;
    this.code = '';
  }

  private attach(c: DataConnection) {
    this.conn = c;
    c.on('open', () => {
      this.status = 'connected';
      c.send({ t: 'hello', v: PROTOCOL_VERSION } satisfies Msg);
      this.onConnected();
    });
    c.on('data', (d) => this.onMessage(d as Msg));
    c.on('close', () => this.closed());
    c.on('error', (e) => this.fail(e.message));
  }

  private closed() {
    if (this.status === 'connected') {
      this.status = 'closed';
      this.onClosed();
    }
    this.conn = null;
  }

  private fail(msg: string) {
    const wasConnected = this.status === 'connected';
    this.status = 'error';
    this.error = msg;
    if (wasConnected) this.onClosed();
  }

  private reset() {
    this.error = '';
    this.conn?.close();
    this.conn = null;
    this.peer?.destroy();
    this.peer = null;
  }
}
