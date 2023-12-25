import { Server } from "socket.io";
import { NamespaceEvent } from "./typed-events";
import { Store } from "./stores";
interface BasicAuthentication {
    type: "basic";
    username: string;
    password: string;
}
interface InstrumentOptions {
    /**
     * The name of the admin namespace
     *
     * @default "/admin"
     */
    namespaceName: string;
    /**
     * The authentication method
     */
    auth?: false | BasicAuthentication;
    /**
     * Whether updates are allowed
     * @default false
     */
    readonly: boolean;
    /**
     * The unique ID of the server
     * @default `require("os").hostname()`
     */
    serverId?: string;
    /**
     * The store
     */
    store: Store;
    /**
     * Whether to send all events or only aggregated events to the UI, for performance purposes.
     */
    mode: "development" | "production";
}
declare module "socket.io" {
    interface Server {
        _eventBuffer: EventBuffer;
        _pollingClientsCount: number;
    }
}
declare class EventBuffer {
    private buffer;
    push(type: string, subType?: string, count?: number): void;
    getValuesAndClear(): NamespaceEvent[];
}
export declare function instrument(io: Server, opts: Partial<InstrumentOptions>): void;
export { InMemoryStore, RedisStore } from "./stores";
