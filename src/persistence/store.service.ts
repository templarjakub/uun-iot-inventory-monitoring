import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import mongoose, { Model } from "mongoose";
import { env } from "../common/config/env";
import { Product, ProductSchema } from "./schemas/product.schema";
import { WeighingPoint, WeighingPointSchema } from "./schemas/weighing-point.schema";
import { Measurement, MeasurementSchema } from "./schemas/measurement.schema";
import { IotNode, IotNodeSchema } from "./schemas/iot-node.schema";
import { IotGateway, IotGatewaySchema } from "./schemas/iot-gateway.schema";

export interface DatabaseState {
  product: Product[];
  weighingPoint: WeighingPoint[];
  measurement: Measurement[];
  iotNode: IotNode[];
  iotGateway: IotGateway[];
}

const DATA_DIR = path.resolve(process.cwd(), "data");
const LOCAL_DB_FILE = path.join(DATA_DIR, "biot-store.json");

export function generateObjectId(): string {
  return crypto.randomBytes(12).toString("hex");
}

function getInitialSeedState(): DatabaseState {
  const now = new Date().toISOString();
  return {
    product: [
      {
        id: "671b5e9a1c2d3e4f5a6b7c8d",
        awid: env.AWID,
        productId: "PRD-001",
        productName: "Šroub M6 × 20 mm",
        unitWeight: 6.0,
        minimumStock: 50,
        sys: { cts: "2026-10-25T09:00:00.000Z", mts: now, rev: 1 }
      },
      {
        id: "671b5e9a1c2d3e4f5a6b7c8f",
        awid: env.AWID,
        productId: "PRD-002",
        productName: "Matice M6, zinek",
        unitWeight: 2.5,
        minimumStock: 30,
        sys: { cts: "2026-10-25T09:05:00.000Z", mts: now, rev: 1 }
      },
      {
        id: "671b5e9a1c2d3e4f5a6b7c99",
        awid: env.AWID,
        productId: "PRD-003",
        productName: "Podložka 6,4 mm",
        unitWeight: null,
        minimumStock: null,
        sys: { cts: "2026-10-25T09:10:00.000Z", mts: now, rev: 0 }
      }
    ],
    iotGateway: [
      {
        id: "671b60101c2d3e4f5a6b7c90",
        awid: env.AWID,
        gatewayId: "BR-001",
        gatewayName: "Brána skladu dílny",
        authorizationStatus: "verified",
        nodeIds: ["UZ-001"],
        deliveryState: "deliveredAndRetained",
        sys: { cts: "2026-10-25T08:00:00.000Z", mts: now, rev: 2 }
      }
    ],
    iotNode: [
      {
        id: "671b60501c2d3e4f5a6b7c91",
        awid: env.AWID,
        nodeId: "UZ-001",
        nodeName: "Vážicí uzel regálu A",
        sourceIds: ["UZ-001/V1", "UZ-001/V2", "UZ-001/V3"],
        gatewayId: "BR-001",
        measurementStatus: "active",
        sys: { cts: "2026-10-25T08:30:00.000Z", mts: now, rev: 1 }
      }
    ],
    weighingPoint: [
      {
        id: "671b5f001c2d3e4f5a6b7c8e",
        awid: env.AWID,
        weighingPointId: "VM-001",
        weighingPointName: "Regál A, pozice 1",
        productId: "PRD-001",
        tareWeight: 100.0,
        sourceId: "UZ-001/V1",
        configurationValidFrom: "2026-10-25T09:50:00.000Z",
        lastValidStockEstimate: 30,
        lastValidMeasuredAt: now,
        measurementStatus: "current",
        sys: { cts: "2026-10-25T09:00:00.000Z", mts: now, rev: 2 }
      },
      {
        id: "671b5f001c2d3e4f5a6b7c8a",
        awid: env.AWID,
        weighingPointId: "VM-002",
        weighingPointName: "Regál A, pozice 2",
        productId: "PRD-001",
        tareWeight: 100.0,
        sourceId: "UZ-001/V2",
        configurationValidFrom: "2026-10-25T09:50:00.000Z",
        lastValidStockEstimate: 10,
        lastValidMeasuredAt: now,
        measurementStatus: "current",
        sys: { cts: "2026-10-25T09:00:00.000Z", mts: now, rev: 2 }
      }
    ],
    measurement: [
      {
        id: "671b61001c2d3e4f5a6b7c95",
        awid: env.AWID,
        measurementId: "M-20261025-0101",
        weighingPointId: "VM-001",
        sourceId: "UZ-001/V1",
        gatewayId: "BR-001",
        measuredWeight: 280.0,
        measuredAt: now,
        receivedAt: now,
        measurementQuality: "validAndStable",
        sys: { cts: now, mts: now, rev: 0 }
      },
      {
        id: "671b61001c2d3e4f5a6b7c96",
        awid: env.AWID,
        measurementId: "M-20261025-0102",
        weighingPointId: "VM-002",
        sourceId: "UZ-001/V2",
        gatewayId: "BR-001",
        measuredWeight: 160.0,
        measuredAt: now,
        receivedAt: now,
        measurementQuality: "validAndStable",
        sys: { cts: now, mts: now, rev: 0 }
      }
    ]
  };
}

@Injectable()
export class StoreService implements OnModuleInit {
  private isMongoConnected = false;
  private memoryState: DatabaseState | null = null;

  public readonly models: {
    product: Model<Product>;
    weighingPoint: Model<WeighingPoint>;
    measurement: Model<Measurement>;
    iotNode: Model<IotNode>;
    iotGateway: Model<IotGateway>;
  };

  constructor() {
    this.models = {
      product:
        (mongoose.models[Product.name] as Model<Product>) ||
        mongoose.model<Product>(Product.name, ProductSchema),
      weighingPoint:
        (mongoose.models[WeighingPoint.name] as Model<WeighingPoint>) ||
        mongoose.model<WeighingPoint>(WeighingPoint.name, WeighingPointSchema),
      measurement:
        (mongoose.models[Measurement.name] as Model<Measurement>) ||
        mongoose.model<Measurement>(Measurement.name, MeasurementSchema),
      iotNode:
        (mongoose.models[IotNode.name] as Model<IotNode>) ||
        mongoose.model<IotNode>(IotNode.name, IotNodeSchema),
      iotGateway:
        (mongoose.models[IotGateway.name] as Model<IotGateway>) ||
        mongoose.model<IotGateway>(IotGateway.name, IotGatewaySchema)
    };
  }

  async onModuleInit(): Promise<void> {
    if (env.MONGODB_URI) {
      await mongoose.connect(env.MONGODB_URI);
      this.isMongoConnected = true;
      console.log("✅ Connected to MongoDB Atlas via Mongoose (@nestjs/mongoose schemas)");
      return;
    }

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(LOCAL_DB_FILE)) {
      const raw = fs.readFileSync(LOCAL_DB_FILE, "utf-8");
      this.memoryState = JSON.parse(raw) as DatabaseState;
    } else {
      this.memoryState = getInitialSeedState();
      this.persistLocal();
    }
    console.log(`✅ Using local persistent Mongoose-validated store (${LOCAL_DB_FILE})`);
  }

  private getLocalState(): DatabaseState {
    if (!this.memoryState) {
      this.memoryState = getInitialSeedState();
    }
    return this.memoryState;
  }

  private persistLocal(): void {
    if (!this.memoryState) return;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LOCAL_DB_FILE, JSON.stringify(this.memoryState, null, 2), "utf-8");
  }

  async list<K extends keyof DatabaseState>(
    collection: K
  ): Promise<DatabaseState[K]> {
    if (this.isMongoConnected) {
      const ModelClass = this.models[collection] as Model<any>;
      const docs = await ModelClass.find({}, { _id: 0 }).lean().exec();
      return docs as unknown as DatabaseState[K];
    }
    return [...this.getLocalState()[collection]] as DatabaseState[K];
  }

  async insert<K extends keyof DatabaseState>(
    collection: K,
    doc: DatabaseState[K][number]
  ): Promise<DatabaseState[K][number]> {
    // Validate document against its Mongoose Schema before saving
    const ModelClass = this.models[collection] as Model<any>;
    const mongooseDoc = new ModelClass(doc);
    await mongooseDoc.validate();

    if (this.isMongoConnected) {
      await mongooseDoc.save();
      return doc;
    }
    const list = this.getLocalState()[collection] as DatabaseState[K][number][];
    list.push(doc);
    this.persistLocal();
    return doc;
  }

  async update<K extends keyof DatabaseState>(
    collection: K,
    id: string,
    updater: (existing: DatabaseState[K][number]) => DatabaseState[K][number]
  ): Promise<DatabaseState[K][number] | null> {
    const ModelClass = this.models[collection] as Model<any>;

    if (this.isMongoConnected) {
      const existing = await ModelClass.findOne({ id }, { _id: 0 }).lean().exec();
      if (!existing) return null;
      const updated = updater(existing as unknown as DatabaseState[K][number]);
      updated.sys = {
        ...updated.sys,
        mts: new Date().toISOString(),
        rev: (updated.sys?.rev ?? 0) + 1
      };
      await new ModelClass(updated).validate();
      await ModelClass.replaceOne({ id }, { ...updated }).exec();
      return updated;
    }

    const list = this.getLocalState()[collection] as DatabaseState[K][number][];
    const idx = list.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    const updated = updater(list[idx]);
    updated.sys = {
      ...updated.sys,
      mts: new Date().toISOString(),
      rev: (updated.sys?.rev ?? 0) + 1
    };
    await new ModelClass(updated).validate();
    list[idx] = updated;
    this.persistLocal();
    return updated;
  }

  async delete<K extends keyof DatabaseState>(
    collection: K,
    id: string
  ): Promise<void> {
    if (this.isMongoConnected) {
      const ModelClass = this.models[collection] as Model<any>;
      await ModelClass.deleteOne({ id }).exec();
      return;
    }
    const state = this.getLocalState();
    const list = state[collection] as DatabaseState[K][number][];
    (state[collection] as unknown) = list.filter((item) => item.id !== id);
    this.persistLocal();
  }
}
