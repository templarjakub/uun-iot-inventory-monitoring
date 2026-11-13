import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import { WeighingPoint } from "../schemas/weighing-point.schema";
import { StoreService, generateObjectId } from "../store.service";

@Injectable()
export class WeighingPointDao {
  constructor(private readonly store: StoreService) {}

  async create(data: {
    weighingPointId?: string;
    weighingPointName: string;
    sourceId: string;
    configurationValidFrom: string;
  }): Promise<WeighingPoint> {
    const all = await this.store.list("weighingPoint");
    let weighingPointId =
      data.weighingPointId || `VM-${String(all.length + 1).padStart(3, "0")}`;
    while (
      !data.weighingPointId &&
      all.some((w) => w.weighingPointId === weighingPointId)
    ) {
      weighingPointId = `VM-${String(Math.floor(100 + Math.random() * 900))}`;
    }
    const now = new Date().toISOString();
    const entity: WeighingPoint = {
      id: generateObjectId(),
      awid: env.AWID,
      weighingPointId,
      weighingPointName: data.weighingPointName,
      productId: null,
      tareWeight: null,
      sourceId: data.sourceId,
      configurationValidFrom: data.configurationValidFrom,
      lastValidStockEstimate: null,
      lastValidMeasuredAt: null,
      measurementStatus: "waitingForMeasurement",
      sys: { cts: now, mts: now, rev: 0 }
    };
    return this.store.insert("weighingPoint", entity);
  }

  async get(filter: {
    id?: string;
    weighingPointId?: string;
    sourceId?: string;
  }): Promise<WeighingPoint | null> {
    const all = await this.store.list("weighingPoint");
    return (
      all.find(
        (w) =>
          (filter.id && w.id === filter.id) ||
          (filter.weighingPointId && w.weighingPointId === filter.weighingPointId) ||
          (filter.sourceId && w.sourceId === filter.sourceId)
      ) ?? null
    );
  }

  async list(): Promise<{ itemList: WeighingPoint[] }> {
    const itemList = await this.store.list("weighingPoint");
    return { itemList };
  }

  async listByProductId(productId: string): Promise<{ itemList: WeighingPoint[] }> {
    const all = await this.store.list("weighingPoint");
    return { itemList: all.filter((w) => w.productId === productId) };
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        WeighingPoint,
        | "weighingPointName"
        | "productId"
        | "tareWeight"
        | "sourceId"
        | "configurationValidFrom"
        | "lastValidStockEstimate"
        | "lastValidMeasuredAt"
        | "measurementStatus"
      >
    >
  ): Promise<WeighingPoint | null> {
    return this.store.update("weighingPoint", id, (existing) => ({
      ...existing,
      ...patch
    }));
  }

  async delete(id: string): Promise<void> {
    await this.store.delete("weighingPoint", id);
  }
}
