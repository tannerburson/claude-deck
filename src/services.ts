import type { Service, ServiceSummary, Slot } from "./types.js";

// In-memory registries
export const services = new Map<string, Service>();
export const slotsFree: Slot[] = [];
export const slotByContext = new Map<string, Slot>();

// Listeners notified whenever any service changes state (start/finish/clear),
// so aggregate views can repaint without being wired into every mutation site.
const changeListeners = new Set<() => void>();

export function onServicesChanged(listener: () => void) {
  changeListeners.add(listener);
}

export function notifyServicesChanged() {
  for (const listener of changeListeners) {
    listener();
  }
}

export function summarizeServices(): ServiceSummary {
  const summary: ServiceSummary = { running: 0, attention: 0, completed: 0, failed: 0, tracked: 0 };
  for (const service of services.values()) {
    if (service.state === "idle") continue;
    summary.tracked++;
    summary[service.state]++;
  }
  return summary;
}

export function clearServiceAnimation(service: Service) {
  if (service.animationTimer) {
    clearInterval(service.animationTimer);
    service.animationTimer = undefined;
  }
}

export function unbindServiceFromSlot(serviceId: string, context: string) {
  const service = services.get(serviceId);
  if (service && service.assignedContext === context) {
    clearServiceAnimation(service);
    service.assignedContext = undefined;
  }
}

export function clearServiceFromSlot(serviceId: string, context: string) {
  const service = services.get(serviceId);
  if (service && service.assignedContext === context) {
    clearServiceAnimation(service);
    service.assignedContext = undefined;
    service.state = "idle";
    const slot = slotByContext.get(context);
    if (slot) {
      slotsFree.push(slot);
    }
  }
}

// Remove all completed/failed services, freeing any slots they held.
// Returns the freed slots so the caller can repaint them.
export function clearFinishedServices(): Slot[] {
  const freedSlots: Slot[] = [];
  for (const service of [...services.values()]) {
    if (service.state !== "completed" && service.state !== "failed") continue;
    clearServiceAnimation(service);
    if (service.assignedContext) {
      const slot = slotByContext.get(service.assignedContext);
      if (slot) {
        slotsFree.push(slot);
        freedSlots.push(slot);
      }
      service.assignedContext = undefined;
    }
    services.delete(service.id);
  }
  return freedSlots;
}

export function findServiceByContext(context: string): Service | undefined {
  return [...services.values()].find((s) => s.assignedContext === context);
}

export function findUnassignedActiveService(): Service | undefined {
  return [...services.values()].find((s) => !s.assignedContext && s.state !== "idle");
}

export function getOrCreateService(id: string, name: string): Service {
  let service = services.get(id);
  if (!service) {
    service = { id, name, state: "idle" };
    services.set(id, service);
  } else {
    service.name = name;
  }
  return service;
}

export function assignServiceToSlot(service: Service): Slot | null {
  if (service.assignedContext) {
    return slotByContext.get(service.assignedContext) || null;
  }

  if (!slotsFree.length) {
    return null;
  }

  const slot = slotsFree.shift()!;
  service.assignedContext = slot.context;
  return slot;
}
