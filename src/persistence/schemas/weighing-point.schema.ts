import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";
import { SysMetadata } from "./product.schema";

export type WeighingPointMeasurementStatus =
  | "current"
  | "stale"
  | "waitingForMeasurement"
  | "incompleteConfig";

export type WeighingPointDocument = HydratedDocument<WeighingPoint>;

/**
 * Schema 2: weighingPoint (Vážicí místo) – BIOT DL Application Model - Tým 4 (Persistence Layer)
 */
@Schema({ collection: "weighingPoint", versionKey: false })
export class WeighingPoint {
  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true })
  awid: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  weighingPointId: string; // e.g. "VM-001"

  @Prop({ type: String, required: true })
  weighingPointName: string; // e.g. "Regál A, pozice 1"

  @Prop({ type: String, default: null, index: true })
  productId: string | null; // FK -> product.productId

  @Prop({ type: Number, default: null })
  tareWeight: number | null; // verified empty box weight in grams

  @Prop({ type: String, required: true, unique: true, index: true })
  sourceId: string; // e.g. "UZ-001/V1"

  @Prop({ type: String, required: true })
  configurationValidFrom: string; // ISO-8601 timestamp

  @Prop({ type: Number, default: null })
  lastValidStockEstimate: number | null;

  @Prop({ type: String, default: null })
  lastValidMeasuredAt: string | null;

  @Prop({ type: String, required: true, default: "waitingForMeasurement" })
  measurementStatus: WeighingPointMeasurementStatus;

  @Prop({ type: Object, required: true })
  sys: SysMetadata;
}

export const WeighingPointSchema = SchemaFactory.createForClass(WeighingPoint);
