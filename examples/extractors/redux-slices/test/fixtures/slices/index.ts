import { sliceFactory } from "./barrel.js"; import { cart, total as cartTotal } from "./cart.js";
export const checkout = sliceFactory({ name: "checkout", initialState: 0, reducers: { pay(state: number) { return state; } }, extraReducers(builder) { builder.addCase(cart.actions.add, () => cartTotal(0)); } });
function createSlice(x: unknown) { return x; } const decoy = createSlice({ name: "not-redux" });
