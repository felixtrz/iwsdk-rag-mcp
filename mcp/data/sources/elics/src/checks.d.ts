export declare function toggleChecks(value: boolean): void;
export declare enum ErrorMessages {
    TypeNotSupported = "Type not supported",
    InvalidDefaultValue = "Invalid default value",
    InvalidEnumValue = "Invalid enum value",
    InvalidRangeValue = "Value out of range"
}
export declare function assertCondition(condition: boolean, message: ErrorMessages, object: unknown): void;
export declare function assertValidEnumValue(value: string, enumObject: {
    [key: string]: string;
}, fieldName: string): void;
export declare function assertValidRangeValue(value: number, min: number | undefined, max: number | undefined, fieldName: string): void;
//# sourceMappingURL=checks.d.ts.map