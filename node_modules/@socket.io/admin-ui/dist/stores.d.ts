export declare abstract class Store {
    abstract doesSessionExist(sessionId: string): Promise<boolean>;
    abstract saveSession(sessionId: string): void;
}
export declare class InMemoryStore extends Store {
    private sessions;
    doesSessionExist(sessionId: string): Promise<boolean>;
    saveSession(sessionId: string): void;
}
interface RedisStoreOptions {
    /**
     * The prefix of the keys stored in Redis
     * @default "socket.io-admin"
     */
    prefix: string;
    /**
     * The duration of the session in seconds
     * @default 86400
     */
    sessionDuration: number;
}
export declare class RedisStore extends Store {
    readonly redisClient: any;
    private options;
    constructor(redisClient: any, options?: Partial<RedisStoreOptions>);
    private computeKey;
    doesSessionExist(sessionId: string): Promise<boolean>;
    saveSession(sessionId: string): void;
}
export {};
