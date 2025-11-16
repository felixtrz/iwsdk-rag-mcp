import { AnyComponent, DataArrayToType, TypeValueToType, TypedArray } from './types.js';
import type { ComponentManager } from './component-manager.js';
import type { ComponentMask } from './component.js';
import type { EntityManager } from './entity-manager.js';
import type { QueryManager } from './query-manager.js';
export type VectorKeys<C extends AnyComponent> = {
    [K in keyof C['schema']]: DataArrayToType<C['schema'][K]['type']> extends TypedArray ? K : never;
}[keyof C['schema']];
export declare class Entity {
    protected entityManager: EntityManager;
    protected queryManager: QueryManager;
    protected componentManager: ComponentManager;
    readonly index: number;
    bitmask: ComponentMask;
    active: boolean;
    private vectorViews;
    constructor(entityManager: EntityManager, queryManager: QueryManager, componentManager: ComponentManager, index: number);
    addComponent<C extends AnyComponent>(component: C, initialData?: Partial<{
        [K in keyof C['schema']]: TypeValueToType<C['schema'][K]['type']>;
    }>): this;
    removeComponent(component: AnyComponent): this;
    hasComponent(component: AnyComponent): boolean;
    getComponents(): AnyComponent[];
    getValue<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K): TypeValueToType<C['schema'][K]['type']> | null;
    setValue<C extends AnyComponent, K extends keyof C['schema']>(component: C, key: K, value: TypeValueToType<C['schema'][K]['type']>): void;
    getVectorView<C extends AnyComponent, K extends VectorKeys<C>>(component: C, key: K): DataArrayToType<C['schema'][K]['type']>;
    destroy(): void;
}
export type EntityConstructor = {
    new (_em: EntityManager, _qm: QueryManager, _cm: ComponentManager, _idx: number): Entity;
};
//# sourceMappingURL=entity.d.ts.map