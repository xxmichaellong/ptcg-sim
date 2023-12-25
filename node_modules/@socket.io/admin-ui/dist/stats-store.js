"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatsStore = void 0;
const truncateDateToSeconds = (date) => {
    const time = date.getTime();
    return time - (time % 1000);
};
class StatsStore {
    constructor(ttl) {
        this.ttl = ttl;
        this.stats = new Map();
    }
    incr(statsName, delta, date = new Date()) {
        const statsMap = this.getOrCreate(statsName);
        const truncatedDate = truncateDateToSeconds(date);
        statsMap.set(truncatedDate, (statsMap.get(truncatedDate) || 0) + delta);
    }
    getOrCreate(statsName) {
        if (this.stats.has(statsName)) {
            return this.stats.get(statsName);
        }
        else {
            const map = new Map();
            this.stats.set(statsName, map);
            return map;
        }
    }
    dump(date = new Date()) {
        const values = {};
        const expiryDate = truncateDateToSeconds(date) - this.ttl * 1000;
        this.stats.forEach((statsPerDate, statsName) => {
            values[statsName] = {};
            statsPerDate.forEach((value, date) => {
                if (date < expiryDate) {
                    statsPerDate.delete(date);
                }
                else {
                    values[statsName][date] = value;
                }
            });
        });
        return values;
    }
}
exports.StatsStore = StatsStore;
