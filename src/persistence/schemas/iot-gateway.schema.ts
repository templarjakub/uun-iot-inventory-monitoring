import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { SysMetadata } from "./product.schema";

export type GatewayAuthStatus = "registered" | "verified" | "verificationFailed";
export type GatewayDeliveryState = "idle" | "deliveredAndRetained" | "waitingForRetry";

export type IotGatewayDocument = HydratedDocument<IotGateway>;

/**
 * Schema 5: iotGateway (Gateway) – BIOT DL Application Model - Tým 4 (Persistence Layer)
 */
@Schema({ collection: "iotGateway", versionKey: false })
export class IotGateway {
  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true })
  awid: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  gatewayId: string; // e.g. "BR-001"

  @Prop({ type: String, required: true })
  gatewayName: string; // e.g. "Brána skladu dílny"

  @Prop({ type: String, required: true, default: "verified" })
  authorizationStatus: GatewayAuthStatus;

  @Prop({ type: [String], default: [] })
  nodeIds: string[]; // e.g. ["UZ-001"]

  @Prop({ type: String, required: true, default: "idle" })
  deliveryState: GatewayDeliveryState;

  @Prop({ type: Object, required: true })
  sys: SysMetadata;
}

export const IotGatewaySchema = SchemaFactory.createForClass(IotGateway);
