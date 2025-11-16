import type { AnyComponent } from './types.js';
import type { ValuePredicate } from './query.js';
type ValueOf<C extends AnyComponent, K extends keyof C['schema']> = import('./types.js').TypeValueToType<C['schema'][K]['type']>;
type KeysOfType<C extends AnyComponent, T> = {
    [K in keyof C['schema']]: ValueOf<C, K> extends T ? K : never;
}[keyof C['schema']];
type NumericKeys<C extends AnyComponent> = KeysOfType<C, number>;
export declare function eq<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function ne<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function lt<C extends AnyComponent, K extends NumericKeys<C>>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function le<C extends AnyComponent, K extends NumericKeys<C>>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function gt<C extends AnyComponent, K extends NumericKeys<C>>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function ge<C extends AnyComponent, K extends NumericKeys<C>>(component: C, key: K, value: ValueOf<C, K>): ValuePredicate;
export declare function isin<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K, values: ReadonlyArray<ValueOf<C, K>>): ValuePredicate;
export declare function nin<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K, values: ReadonlyArray<ValueOf<C, K>>): ValuePredicate;
export {};
//# sourceMappingURL=query-helpers.d.ts.map