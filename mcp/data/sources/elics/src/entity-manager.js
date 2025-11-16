import { Entity } from './entity.js';
export class EntityManager {
    constructor(queryManager, componentManager, entityReleaseCallback) {
        this.queryManager = queryManager;
        this.componentManager = componentManager;
        this.entityReleaseCallback = entityReleaseCallback;
        this.pool = [];
        this.entityIndex = 0;
        this.indexLookup = [];
        this.poolSize = 0;
    }
    requestEntityInstance() {
        let entity;
        if (this.poolSize > 0) {
            entity = this.pool[--this.poolSize];
            entity.active = true;
        }
        else {
            entity = new Entity(this, this.queryManager, this.componentManager, this.entityIndex++);
        }
        this.indexLookup[entity.index] = entity;
        return entity;
    }
    releaseEntityInstance(entity) {
        var _a;
        (_a = this.entityReleaseCallback) === null || _a === void 0 ? void 0 : _a.call(this, entity);
        this.indexLookup[entity.index] = null;
        this.pool[this.poolSize++] = entity;
    }
    getEntityByIndex(index) {
        var _a;
        if (index === -1) {
            return null;
        }
        return (_a = this.indexLookup[index]) !== null && _a !== void 0 ? _a : null;
    }
}
//# sourceMappingURL=entity-manager.js.map