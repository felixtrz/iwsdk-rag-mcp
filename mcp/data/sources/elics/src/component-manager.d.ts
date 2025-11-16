import type { AnyComponent } from './types.js';
export declare class ComponentManager {
    private entityCapacity;
    private nextComponentTypeId;
    private componentsByTypeId;
    constructor(entityCapacity: number);
    hasComponent(component: AnyComponent): boolean;
    registerComponent(component: AnyComponent): void;
    attachComponentToEntity(entityIndex: number, component: AnyComponent, initialData: Record<string, unknown>): void;
    getComponentByTypeId(typeId: number): AnyComponent | null;
}
//# sourceMappingURL=component-manager.d.ts.map