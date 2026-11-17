import type { MainTab, Route } from './routes.ts';

export type NavigationAction = { type: 'go'; route: Route } | { type: 'back' };
export interface NavigationState {
  route: Route;
  tab: MainTab;
  history: Route[];
}
export const initialNavigation: NavigationState = {
  route: { name: 'today' },
  tab: 'today',
  history: [],
};
export const mainTabs = ['today', 'words', 'practice', 'notebook', 'profile'] as const;
export const isMainTab = (route: Route): route is { name: MainTab } =>
  mainTabs.some((tab) => tab === route.name);

/** Back consumes history; it must never be reinterpreted as a forward action. */
export function navigate(state: NavigationState, action: NavigationAction): NavigationState {
  const route = action.type === 'go' ? action.route : (state.history.at(-1) ?? { name: state.tab });
  if (action.type === 'go' && route.name === state.route.name && isMainTab(route)) return state;
  return {
    route,
    tab: isMainTab(route) ? route.name : state.tab,
    history: action.type === 'go' ? [...state.history, state.route] : state.history.slice(0, -1),
  };
}
