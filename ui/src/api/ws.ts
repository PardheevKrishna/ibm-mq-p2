import { useEffect, useRef, useState } from "react";

type Handler = (msg: any) => void;

export function useBclSocket(onMessage: Handler) {
  const [connected, setConnected] = useState(false);
  const ref = useRef<WebSocket | null>(null);
  const handlerRef = useRef<Handler>(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    let alive = true;
    let attempt = 0;

    function connect() {
      const ws = new WebSocket(url);
      ref.current = ws;
      ws.onopen = () => {
        if (!alive) return;
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        try {
          handlerRef.current(JSON.parse(ev.data));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!alive) return;
        attempt++;
        const wait = Math.min(5000, 500 * attempt);
        setTimeout(connect, wait);
      };
      ws.onerror = () => ws.close();
    }
    connect();

    return () => {
      alive = false;
      ref.current?.close();
    };
  }, []);

  return connected;
}
