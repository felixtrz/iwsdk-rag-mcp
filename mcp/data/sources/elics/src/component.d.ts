import { AnyComponent, DataArrayToType, DataType, TypedSchema } from './types.js';
import BitSet from './bit-set.js';
export type ComponentMask = BitSet;
export interface Component<S extends TypedSchema<DataType>> {
    id: string;
    description?: string;
    schema: S;
    data: {
        [K in keyof S]: DataArrayToType<S[K]['type']>;
    };
    bitmask: ComponentMask | null;
    typeId: number;
}
export declare class ComponentRegistry {
    private static components;
    static record(component: AnyComponent): void;
    static getById(id: string): AnyComponent | undefined;
    static getAllComponents(): AnyComponent[];
    static has(id: string): boolean;
    static clear(): void;
}
export declare function createComponent<T extends DataType, S extends TypedSchema<T>>(id: string, schema: S, description?: string): Component<S>;
export declare function initializeComponentStorage<T extends DataType, S extends TypedSchema<T>>(component: Component<S>, entityCapacity: number): void;
export declare function assignInitialComponentData<T extends DataType, S extends TypedSchema<T>>(component: Component<S>, index: number, initialData: Record<string, unknown>): void;
//# sourceMappingURL=component.d.ts.map