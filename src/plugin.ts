import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyUpEvent,
} from "@elgato/streamdeck";

import type { AggregateView, Slot } from "./types.js";
import {
  services,
  slotsFree,
  slotByContext,
  findServiceByContext,
  findUnassignedActiveService,
  assignServiceToSlot,
  unbindServiceFromSlot,
  clearServiceFromSlot,
  clearFinishedServices,
  summarizeServices,
  onServicesChanged,
  notifyServicesChanged,
} from "./services.js";
import {
  paintIdle,
  paintRunning,
  paintAttention,
  paintDone,
  paintFailed,
  paintAggregate,
  stopAggregateAnimation,
} from "./renderer.js";
import { startOrRestartHttp } from "./http-server.js";

// Initialize logging - the SDK will automatically handle file logging
streamDeck.logger.info("Plugin file is being loaded...");
streamDeck.logger.debug("Plugin starting to load from directory:", __dirname);

// Create scoped loggers
const slotLogger = streamDeck.logger.createScope("Slots");
const aggregateLogger = streamDeck.logger.createScope("Aggregate");

function makeSlot(ev: WillAppearEvent): Slot {
  return {
    context: ev.action.id,
    setTitle: (t?: string) => ev.action.setTitle(t ?? ""),
    setImage: (imagePath?: string) => ev.action.setImage(imagePath),
    showOk: () => Promise.resolve(), // showOk might not be available
    showAlert: () => Promise.resolve(), // showAlert might not be available
  };
}

// Tasks can now be tracked without a slot; when a slot frees up, hand it to
// the oldest unassigned active service so overflow tasks become visible.
async function assignPendingToFreeSlots(): Promise<void> {
  while (slotsFree.length) {
    const svc = findUnassignedActiveService();
    if (!svc) return;
    const slot = assignServiceToSlot(svc);
    if (!slot) return;
    slotLogger.info(`Assigned pending service ${svc.id} to freed slot ${slot.context}`);
    if (svc.state === "running") await paintRunning(slot, svc.name, svc);
    else if (svc.state === "attention") await paintAttention(slot, svc.name);
    else if (svc.state === "failed") await paintFailed(slot, svc.name);
    else await paintDone(slot, svc.name);
  }
}

// -----------------------------
// Action: a single slot key
// -----------------------------

@action({ UUID: "pro.clever.claudedeck.slot" })
class ServiceSlot extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const context = ev.action.id;
    slotLogger.debug(`Slot appearing with context: ${context}`);

    const slot = makeSlot(ev);
    slotByContext.set(context, slot);

    // If some service was previously bound to this context, keep it. Otherwise mark free.
    const existing = findServiceByContext(context);
    if (!existing) {
      slotsFree.push(slot);
      slotLogger.debug(`Slot ${context} added to free pool`);
      await paintIdle(slot);
      await assignPendingToFreeSlots();
    } else {
      slotLogger.debug(`Slot ${context} reconnecting to service ${existing.id} (${existing.state})`);
      // Repaint according to its state
      if (existing.state === "running") await paintRunning(slot, existing.name, existing);
      else if (existing.state === "attention") await paintAttention(slot, existing.name);
      else if (existing.state === "completed") await paintDone(slot, existing.name);
      else if (existing.state === "failed") await paintFailed(slot, existing.name);
      else await paintIdle(slot);
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const context = ev.action.id;
    slotLogger.debug(`Slot disappearing with context: ${context}`);

    // Remove from free list if present
    const idx = slotsFree.findIndex((s) => s.context === context);
    if (idx >= 0) {
      slotsFree.splice(idx, 1);
      slotLogger.debug(`Slot ${context} removed from free pool`);
    }

    // Unbind any service tied to this context
    for (const s of services.values()) {
      if (s.assignedContext === context) {
        slotLogger.debug(`Unbinding service ${s.id} from slot ${context}`);
        unbindServiceFromSlot(s.id, context);
      }
    }
    slotByContext.delete(context);
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const context = ev.action.id;
    slotLogger.debug(`Key pressed on slot ${context}`);

    // If a service is bound here and is completed/failed/running, clear it.
    const bound = findServiceByContext(context);
    if (bound) {
      slotLogger.info(`Clearing service ${bound.id} from slot ${context}`);
      clearServiceFromSlot(bound.id, context);
      await paintIdle(slotByContext.get(context)!);
      // Freed slot may immediately go to an overflow task waiting for a key
      await assignPendingToFreeSlots();
      notifyServicesChanged();
    } else {
      slotLogger.debug(`No service bound to slot ${context}, repainting idle`);
      // Nothing bound -> just repaint idle
      await paintIdle(slotByContext.get(context)!);
    }
  }
}

// -----------------------------
// Action: aggregate status key
// -----------------------------

const aggregateViews = new Map<string, AggregateView>();

async function repaintAggregates(): Promise<void> {
  if (!aggregateViews.size) return;
  const summary = summarizeServices();
  for (const view of aggregateViews.values()) {
    await paintAggregate(view, summary);
  }
}

onServicesChanged(() => {
  repaintAggregates().catch((err) =>
    aggregateLogger.error("Failed to repaint aggregate keys:", err)
  );
});

@action({ UUID: "pro.clever.claudedeck.aggregate" })
class AggregateSlot extends SingletonAction {
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const context = ev.action.id;
    aggregateLogger.debug(`Aggregate key appearing with context: ${context}`);

    const view: AggregateView = { slot: makeSlot(ev) };
    aggregateViews.set(context, view);
    await paintAggregate(view, summarizeServices());
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const context = ev.action.id;
    aggregateLogger.debug(`Aggregate key disappearing with context: ${context}`);

    const view = aggregateViews.get(context);
    if (view) {
      stopAggregateAnimation(view);
      aggregateViews.delete(context);
    }
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    aggregateLogger.info("Aggregate key pressed, clearing all finished services");

    const freedSlots = clearFinishedServices();
    for (const slot of freedSlots) {
      await paintIdle(slot);
    }
    // Freed slots may immediately go to overflow tasks waiting for a key
    await assignPendingToFreeSlots();
    notifyServicesChanged();
  }
}

// Register and connect the plugin
streamDeck.logger.info("Registering actions...");
streamDeck.actions.registerAction(new ServiceSlot());
streamDeck.actions.registerAction(new AggregateSlot());
streamDeck.logger.info("Actions registered successfully");

// Kick off the connection (then bootstrap the HTTP server)
streamDeck.logger.info("Plugin starting, connecting to Stream Deck...");
streamDeck.connect().then(() => {
  streamDeck.logger.info("Connected to Stream Deck, starting HTTP server...");
  return startOrRestartHttp();
}).catch((err) => {
  streamDeck.logger.error("Failed to connect to Stream Deck:", err.message);
});
