export class EventBus {
  constructor() { this.listeners = new Map(); }
  on(event, handler) { if(!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event).add(handler); return () => this.off(event, handler); }
  off(event, handler) { if(this.listeners.has(event)) this.listeners.get(event).delete(handler); }
  emit(event, payload) { if(this.listeners.has(event)) { for(const h of this.listeners.get(event)) { try { h(payload); } catch(e){ console.error('Event handler error', event, e); } } } }
}
export const bus = new EventBus();
