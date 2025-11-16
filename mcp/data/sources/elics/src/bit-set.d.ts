export default class BitSet {
    private words;
    constructor(init?: number | Uint32Array);
    get bits(): number;
    private ensure;
    set(bitIndex: number, value: number): void;
    or(other: BitSet): BitSet;
    and(other: BitSet): BitSet;
    andNot(other: BitSet): BitSet;
    orInPlace(other: BitSet): void;
    andNotInPlace(other: BitSet): void;
    equals(other: BitSet): boolean;
    isEmpty(): boolean;
    clear(): void;
    toArray(): number[];
    toString(): string;
    contains(other: BitSet): boolean;
    intersects(other: BitSet): boolean;
}
//# sourceMappingURL=bit-set.d.ts.map