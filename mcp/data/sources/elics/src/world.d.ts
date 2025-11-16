import { TypeValueToType } from './types.js';
import { QueryConfig } from './query.js';
import { System, SystemConstructor, SystemQueries, SystemSchema } from './system.js';
import { AnySystem, AnyComponent } from './types.js';
import { ComponentManager } from './component-manager.js';
import { Entity } from './entity.js';
import { EntityManager } from './entity-manager.js';
import { QueryManager } from './query-manager.js';
export interface WorldOptions {
    entityCapacity: number;
    checksOn: boolean;
    entityReleaseCallback?: (entity: Entity) => void;
}
export type SystemConfigData<S extends SystemSchema> = Partial<{
    [K in keyof S]: TypeValueToType<S[K]['type']>;
}>;
export interface SystemOptions<S extends SystemSchema> {
    configData: SystemConfigData<S>;
    priority: number;
}
export declare class World {
    entityManager: EntityManager;
    queryManager: QueryManager;
    componentManager: ComponentManager;
    private systems;
    readonly globals: {
        [key: string]: unknown;
    };
    constructor({ entityCapacity, checksOn, entityReleaseCallback, }?: Partial<WorldOptions>);
    registerComponent(component: AnyComponent): this;
    hasComponent(component: AnyComponent): boolean;
    createEntity(): Entity;
    registerSystem<S extends SystemSchema, Q extends SystemQueries, Sys extends System<S, Q> = System<S, Q>>(systemClass: SystemConstructor<S, Q, typeof this, Sys>, options?: Partial<SystemOptions<S>>): this;
    unregisterSystem<S extends SystemSchema, Q extends SystemQueries, Sys extends System<S, Q>>(systemClass: SystemConstructor<S, Q, typeof this, Sys>): void;
    registerQuery(queryConfig: QueryConfig): this;
    update(delta: number, time: number): void;
    getSystem<S extends SystemSchema, Q extends SystemQueries, Sys extends System<S, Q>>(systemClass: SystemConstructor<S, Q, typeof this, Sys>): Sys | undefined;
    getSystems<T extends AnySystem = AnySystem>(): T[];
    hasSystem<S extends SystemSchema, Q extends SystemQueries, Sys extends System<S, Q>>(systemClass: SystemConstructor<S, Q, typeof this, Sys>): boolean;
}
//# sourceMappingURL=world.d.ts.map