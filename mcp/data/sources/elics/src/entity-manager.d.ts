import type { ComponentManager } from './component-manager.js';
import { Entity } from './entity.js';
import type { QueryManager } from './query-manager.js';
export declare class EntityManager {
    private queryManager;
    private componentManager;
    private entityReleaseCallback?;
    pool: Entity[];
    private entityIndex;
    private indexLookup;
    private poolSize;
    constructor(queryManager: QueryManager, componentManager: ComponentManager, entityReleaseCallback?: ((entity: Entity) => void) | undefined);
    requestEntityInstance(): Entity;
    releaseEntityInstance(entity: Entity): void;
    getEntityByIndex(index: number): Entity | null;
}
//# sourceMappingURL=entity-manager.d.ts.map