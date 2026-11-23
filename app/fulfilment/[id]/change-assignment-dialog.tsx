"use client";

import { useState } from "react";
import { Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * Change the driver, assistant and/or vehicle of a PLANNED or DEPARTED
 * dispatch. The server (PATCH /api/orders/[id]/dispatch/[dispatchId]/assignment)
 * re-validates everything and writes the change -- who, when, why, before and
 * after -- to the order's fulfilment history; this dialog only collects the
 * new values and the required reason. Options come from the same registered,
 * active Personnel/Vehicle lists the dispatch form uses (never free-typed).
 */

type PersonnelOption = { id: string; name: string };
type VehicleOption = { id: string; registrationNumber: string };

type Props = {
  orderId: string;
  dispatchId: string;
  current: { driverId: string | null; assistantId: string | null; vehicleId: string | null };
  drivers: PersonnelOption[];
  assistants: PersonnelOption[];
  vehicles: VehicleOption[];
  onChanged: () => void;
};

// Radix Select cannot hold an empty-string value, so "keep as is" uses a sentinel.
const KEEP = "__keep__";

export default function ChangeAssignmentDialog({ orderId, dispatchId, current, drivers, assistants, vehicles, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [driverId, setDriverId] = useState(KEEP);
  const [assistantId, setAssistantId] = useState(KEEP);
  const [vehicleId, setVehicleId] = useState(KEEP);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDriverId(KEEP);
    setAssistantId(KEEP);
    setVehicleId(KEEP);
    setReason("");
    setError(null);
  }

  async function save() {
    const changes: Record<string, string> = {};
    if (driverId !== KEEP && driverId !== current.driverId) changes.driverId = driverId;
    if (assistantId !== KEEP && assistantId !== current.assistantId) changes.assistantId = assistantId;
    if (vehicleId !== KEEP && vehicleId !== current.vehicleId) changes.vehicleId = vehicleId;

    if (Object.keys(changes).length === 0) {
      setError("Choose a different driver, assistant or vehicle.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason for the change is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/dispatch/${dispatchId}/assignment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...changes, reason: reason.trim() }),
      });
      const body: { success?: boolean; message?: string } = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        const message = body.message ?? "Unable to change the assignment.";
        setError(message);
        toast.error("Assignment not changed", { description: message });
        return;
      }
      toast.success("Assignment changed", { description: "The change has been added to the order's fulfilment history." });
      setOpen(false);
      reset();
      onChanged();
    } catch {
      setError("Could not reach the server.");
      toast.error("Assignment not changed", { description: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="xs">
          <Users /> Change crew / vehicle
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change dispatch assignment</DialogTitle>
          <DialogDescription>
            Leave a field as &ldquo;Keep current&rdquo; to leave it unchanged. The change, your name, the time and the reason are recorded in the
            order&apos;s fulfilment history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Driver</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep current</SelectItem>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Driver&apos;s assistant</Label>
            <Select value={assistantId} onValueChange={setAssistantId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep current</SelectItem>
                {assistants.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vehicle</Label>
            <Select value={vehicleId} onValueChange={setVehicleId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP}>Keep current</SelectItem>
                {vehicles.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.registrationNumber}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`assignment-reason-${dispatchId}`}>Reason for the change</Label>
            <Textarea
              id={`assignment-reason-${dispatchId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={1000}
              placeholder="e.g. Vehicle broke down; replacement truck assigned"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
