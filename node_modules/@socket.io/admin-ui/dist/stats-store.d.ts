export declare class StatsStore {
    readonly ttl: number;
    private stats;
    constructor(ttl: number);
    incr(statsName: string, delta: number, date?: Date): void;
    private getOrCreate;
    dump(date?: Date): any;
}
