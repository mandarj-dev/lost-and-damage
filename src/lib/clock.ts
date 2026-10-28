import { AsyncLocalStorage } from "node:async_hooks";

// The services stamp every action with "now". The demo seed runs steps inside atTime(...) so a case
// can have a realistic history (claim sent 23 days ago, second follow-up yesterday, and so on).
const store = new AsyncLocalStorage<Date>();

export const clockNow = () => store.getStore() ?? new Date();
export const atTime = <T>(at: Date, fn: () => Promise<T>) => store.run(at, fn);
