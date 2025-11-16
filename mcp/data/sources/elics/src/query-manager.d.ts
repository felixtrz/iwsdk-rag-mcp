import { Query, QueryConfig } from './query.js';
import type { ComponentManager } from './component-manager.js';
import type { AnyComponent } from './types.js';
import { Entity } from './entity.js';
export declare class QueryManager {
    private componentManager;
    private queries;
    private trackedEntities;
    private queriesByComponent;
    private queriesByValueComponent;
    constructor(componentManager: ComponentManager);
    registerQuery(query: QueryConfig): Query;
    updateEntity(entity: Entity, changedComponent?: AnyComponent): void;
    updateEntityValue(entity: Entity, component: AnyComponent): void;
    resetEntity(entity: Entity): void;
}
//# sourceMappingURL=query-manager.d.ts.map