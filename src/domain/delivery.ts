export interface DeliveryAddress {
  readonly platform: "slack";
  readonly workspaceId: string;
  readonly channelId: string;
  readonly threadId: string;
  readonly sourceEventId: string;
}

export type DeliveryClaim =
  | { readonly kind: "claimed"; readonly deliveryKey: string }
  | {
      readonly kind: "duplicate";
      readonly status: "processing" | "completed";
    };

export interface DeliveryStore {
  claimDelivery(address: DeliveryAddress): DeliveryClaim;
  completeDelivery(deliveryKey: string): void;
  failDelivery(deliveryKey: string, errorCode: string): void;
}
