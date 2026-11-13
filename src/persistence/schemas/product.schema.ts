import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export interface SysMetadata {
  cts: string;
  mts: string;
  rev: number;
}

export type ProductDocument = HydratedDocument<Product>;

/**
 * Schema 1: product (Produkt) – BIOT DL Application Model - Tým 4 (Persistence Layer)
 */
@Schema({ collection: "product", versionKey: false })
export class Product {
  @Prop({ type: String, required: true, index: true })
  id: string;

  @Prop({ type: String, required: true })
  awid: string;

  @Prop({ type: String, required: true, unique: true, index: true })
  productId: string; // e.g. "PRD-001"

  @Prop({ type: String, required: true })
  productName: string; // e.g. "Šroub M6 × 20 mm"

  @Prop({ type: Number, default: null })
  unitWeight: number | null; // positive average weight of 1 piece in grams

  @Prop({ type: Number, default: null })
  minimumStock: number | null; // non-negative integer minimum stock in pieces

  @Prop({ type: Object, required: true })
  sys: SysMetadata;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
