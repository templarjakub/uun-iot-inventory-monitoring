import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { SysMetadata } from "./product.schema";

export type NodeMeasurementStatus = "unverified" | "testReceived" | "active";

export type IotNodeDocument = HydratedDocument<IotNode>;

/**
 * Schema 4: iotNode (IoT uzel) – BIOT DL Application Model - Tým 4 (Persistence Layer)
 */
@Schema({ collection: "iotNode", versionKey: false })
export class IotNode {
  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true })
  awid: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  nodeId: string; // e.g. "UZ-001"

  @Prop({ type: String, required: true })
  nodeName: string; // e.g. "Vážicí uzel regálu A"

  @Prop({ type: [String], required: true, index: true })
  sourceIds: string[]; // e.g. ["UZ-001/V1", "UZ-001/V2"]

  @Prop({ type: String, required: true, index: true })
  gatewayId: string; // FK -> iotGateway.gatewayId

  @Prop({ type: String, required: true, default: "unverified" })
  measurementStatus: NodeMeasurementStatus;

  @Prop({ type: Object, required: true })
  sys: SysMetadata;
}

export const IotNodeSchema = SchemaFactory.createForClass(IotNode);
