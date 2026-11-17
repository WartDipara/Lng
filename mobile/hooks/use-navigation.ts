import { useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import type { Route } from '../routes.ts';
import { initialNavigation, navigate, type NavigationAction } from '../navigation.ts';

export function useNavigation() {
  const [state, setState] = useState(initialNavigation);
  const [pending, setPending] = useState<NavigationAction>();
  const dirty = useRef(false);

  function dispatch(action: NavigationAction, forced = false) {
    if (dirty.current && !forced) {
      setPending(action);
      return;
    }
    setState((current) => navigate(current, action));
  }
  const back = () => dispatch({ type: 'back' });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (state.route.name === 'today' && !state.history.length) return false;
      back();
      return true;
    });
    return () => subscription.remove();
  }, [state]);

  return {
    route: state.route,
    tab: state.tab,
    pending,
    back,
    go: (route: Route, forced = false) => dispatch({ type: 'go', route }, forced),
    replace: (route: Route) => dispatch({ type: 'go', route, replace: true }),
    setDirty: (value: boolean) => {
      dirty.current = value;
    },
    cancel: () => setPending(undefined),
    discard: () => {
      if (!pending) return;
      dirty.current = false;
      dispatch(pending, true);
      setPending(undefined);
    },
  };
}
