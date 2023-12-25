"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisStore = exports.InMemoryStore = exports.Store = void 0;
class Store {
}
exports.Store = Store;
class InMemoryStore extends Store {
    constructor() {
        super(...arguments);
        this.sessions = new Set();
    }
    doesSessionExist(sessionId) {
        return Promise.resolve(this.sessions.has(sessionId));
    }
    saveSession(sessionId) {
        this.sessions.add(sessionId);
    }
}
exports.InMemoryStore = InMemoryStore;
class RedisStore extends Store {
    constructor(redisClient, options) {
        super();
        this.redisClient = redisClient;
        this.options = Object.assign({
            prefix: "socket.io-admin",
            sessionDuration: 86400,
        }, options);
    }
    computeKey(sessionId) {
        return `${this.options.prefix}#${sessionId}`;
    }
    doesSessionExist(sessionId) {
        return new Promise((resolve, reject) => {
            this.redisClient.exists(this.computeKey(sessionId), (err, result) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve(result === 1);
                }
            });
        });
    }
    saveSession(sessionId) {
        const key = this.computeKey(sessionId);
        this.redisClient
            .multi()
            .set(key, true)
            .expire(key, this.options.sessionDuration)
            .exec();
    }
}
exports.RedisStore = RedisStore;
