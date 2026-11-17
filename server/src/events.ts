import { EventEmitter } from 'node:events';

/** App-wide event bus; index.ts forwards these to the browser over Socket.IO. */
export const bus = new EventEmitter();

export const notifyCampaign = (id: number) => bus.emit('campaign', { id });
export const notifyStats = () => bus.emit('stats', {});
