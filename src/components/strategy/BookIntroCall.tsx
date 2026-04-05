"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface BookIntroCallProps {
  strategyName: string;
  schedulingUrl?: string;
}

const DEFAULT_SCHEDULING_URL = process.env.NEXT_PUBLIC_SCHEDULING_URL || "";

export function BookIntroCall({ strategyName, schedulingUrl }: BookIntroCallProps) {
  const [showModal, setShowModal] = useState(false);
  const url = schedulingUrl || DEFAULT_SCHEDULING_URL;

  if (!url) return null;

  const fullUrl = url.includes("?")
    ? `${url}&strategy=${encodeURIComponent(strategyName)}`
    : `${url}?strategy=${encodeURIComponent(strategyName)}`;

  return (
    <>
      <Button size="sm" onClick={() => setShowModal(true)}>
        Book Intro Call
      </Button>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Book an Intro Call"
      >
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Schedule a call to discuss <span className="font-medium text-text-primary">{strategyName}</span> with our team. We'll connect you with the strategy manager and provide context on the track record.
          </p>
          <div className="rounded-lg border border-border overflow-hidden" style={{ height: "500px" }}>
            <iframe
              src={fullUrl}
              width="100%"
              height="100%"
              frameBorder="0"
              title="Schedule intro call"
            />
          </div>
          <p className="text-xs text-text-muted">
            Typical response time: 1-2 business days. Average time to allocation: 20 days.
          </p>
        </div>
      </Modal>
    </>
  );
}
