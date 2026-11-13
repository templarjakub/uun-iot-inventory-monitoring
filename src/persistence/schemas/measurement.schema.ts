import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { SysMetadata } from "./product.schema";

export type MeasurementQuality = "validAndStable" | "unstable" | "invalid";

export type MeasurementDocument = HydratedDocument<Measurement>;

/**
 * Schema 3: measurement (Měření) – BIOT DL Application Model - Tým 4 (Persistence Layer)
 */
@Schema({ collection: "measurement", versionKey: false })
export class Measurement {
  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true })
  awid: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  measurementId: string; // e.g. "M-20261025-0101"

  @Prop({ type: String, default: null, index: true })
  weighingPointId: string | null; // FK -> weighingPoint.weighingPointId

  @Prop({ type: String, required: true, index: true })
  sourceId: string; // e.g. "UZ-001/V1"

  @Prop({ type: String, required: true, index: true })
  gatewayId: string; // FK -> iotGateway.gatewayId

  @Prop({ type: Number, required: true })
  measuredWeight: number; // gross weight in grams

  @Prop({ type: String, required: true })
  measuredAt: string; // actual acquisition timestamp on IoT node

  @Prop({ type: String, required: true })
  receivedAt: string; // cloud reception timestamp

  @Prop({ type: String, required: true })
  measurementQuality: MeasurementQuality;

  @Prop({ type: Object, required: true })
  sys: SysMetadata;
}

export const MeasurementSchema = SchemaFactory.createForClass(Measurement);
MeasurementSchema.index({ sourceId: 1, measuredAt: -1 });
MeasurementSchema.index({ weighingPointId: 1, measuredAt: -1 });
