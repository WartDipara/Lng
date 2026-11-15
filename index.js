import { registerRootComponent } from 'expo';
import App from './App';

// Persisted data is JSON; Hermes versions without structuredClone need this JSON-only clone.
if (!globalThis.structuredClone) globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));
registerRootComponent(App);
