import { useEffect, useState } from 'react';
import { db } from './db';
import Setup from './screens/Setup';
import BattingOrder from './screens/BattingOrder';
import SprayChart from './screens/SprayChart';
import Settings from './screens/Settings';

export type Route =
  | { screen: 'setup' }
  | { screen: 'settings' }
  | { screen: 'order'; gameId: number }
  | { screen: 'chart'; gameId: number };

export type Nav = (r: Route) => void;

const KEY = 'spray.route';

function loadRoute(): Route {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || '');
    if (r && typeof r.screen === 'string') return r;
  } catch {
    /* first launch */
  }
  return { screen: 'setup' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(loadRoute);
  const [checked, setChecked] = useState(false);

  // On reopen, make sure the saved game still exists; otherwise fall back to setup.
  useEffect(() => {
    (async () => {
      if ('gameId' in route && !(await db.games.get(route.gameId))) setRoute({ screen: 'setup' });
      setChecked(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(route));
    } catch {
      /* private mode */
    }
    window.scrollTo(0, 0);
  }, [route]);

  if (!checked) return null;
  switch (route.screen) {
    case 'setup':
      return <Setup nav={setRoute} />;
    case 'settings':
      return <Settings nav={setRoute} />;
    case 'order':
      return <BattingOrder key={route.gameId} gameId={route.gameId} nav={setRoute} />;
    case 'chart':
      return <SprayChart key={route.gameId} gameId={route.gameId} nav={setRoute} />;
  }
}
