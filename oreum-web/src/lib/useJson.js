import { useEffect, useState } from "react";

const cache = new Map();

// public/data/*.json 을 한 번만 불러와 캐시한다.
export function useJson(path) {
  const [state, setState] = useState(() => (cache.has(path) ? { data: cache.get(path), error: null } : { data: null, error: null }));
  useEffect(() => {
    if (cache.has(path)) return;
    let alive = true;
    fetch(path)
      .then((r) => { if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); })
      .then((d) => { cache.set(path, d); if (alive) setState({ data: d, error: null }); })
      .catch((e) => alive && setState({ data: null, error: e }));
    return () => { alive = false; };
  }, [path]);
  return state;
}
