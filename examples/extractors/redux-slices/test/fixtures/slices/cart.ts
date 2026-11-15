import { sliceFactory as make } from "./barrel.js";
export const cart = make({ name: "cart", initialState: 0, reducers: { add(state: number) { return state + 1; } }, selectors: { total(state: number) { return state; } } });
export const { total } = cart.selectors;
