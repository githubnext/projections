export const CLOCK = Symbol('clock');
export const METRICS = 'METRICS';
export interface Clock { now(): Date }
