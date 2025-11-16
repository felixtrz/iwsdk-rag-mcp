import type { ComponentMask } from './component.js';
import type { AnyComponent } from './types.js';
import BitSet from './bit-set.js';
import { Entity } from './entity.js';
export type ComparisonOperator = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'in' | 'nin';
export type ValuePredicate = {
    component: AnyComponent;
    key: string;
    op: ComparisonOperator;
    value: unknown;
};
export type QueryConfig = {
    required: AnyComponent[];
    excluded?: AnyComponent[];
    where?: ValuePredicate[];
};
export declare class Query {
    requiredMask: ComponentMask;
    excludedMask: ComponentMask;
    queryId: string;
    subscribers: {
        qualify: Set<(entity: Entity) => void>;
        disqualify: Set<(entity: Entity) => void>;
    };
    entities: Set<Entity>;
    private valuePredicates;
    constructor(requiredMask: ComponentMask, excludedMask: ComponentMask, queryId: string, valuePredicates?: (ValuePredicate & {
        valueSet?: Set<unknown>;
    })[]);
    matches(entity: Entity): boolean;
    subscribe(event: 'qualify' | 'disqualify', callback: (entity: Entity) => void, replayExisting?: boolean): () => void;
    static generateQueryInfo(queryConfig: QueryConfig): {
        requiredMask: BitSet;
        excludedMask: BitSet;
        queryId: string;
        valuePredicates: (ValuePredicate & {
            valueSet?: Set<unknown>;
        })[];
    };
}
//# sourceMappingURL=query.d.ts.map