import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import { Measurement, MeasurementQuality } from "../schemas/measurement.schema";
import { StoreService, generateObjectId } from "../store.service";

@Injectable()
export class MeasurementDao {
  constructor(private readonly store: StoreService) {}

  async create(data: {
    measurementId: string;
    weighingPointId: string | null;
    sourceId: string;
    gatewayId: string;
    measuredWeight: number;
    measuredAt: string;
    receivedAt: string;
    measurementQuality: MeasurementQuality;
  }): Promise<Measurement> {
    const now = new Date().toISOString();
    const entity: Measurement = {
      id: generateObjectId(),
      awid: env.AWID,
      ...data,
      sys: { cts: now, mts: now, rev: 0 }
    };
    return this.store.insert("measurement", entity);
  }

  async getByMeasurementId(measurementId: string): Promise<Measurement | null> {
    const all = await this.store.list("measurement");
    return all.find((m) => m.measurementId === measurementId) ?? null;
  }

  async getLatestBySourceId(sourceId: string): Promise<Measurement | null> {
    const all = await this.store.list("measurement");
    const matching = all
      .filter((m) => m.sourceId === sourceId)
      .sort(
        (a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime()
      );
    return matching[0] ?? null;
  }

  async list(filter?: {
    sourceId?: string;
    weighingPointId?: string;
  }): Promise<{ itemList: Measurement[] }> {
    const all = await this.store.list("measurement");
    const filtered = all.filter(
      (m) =>
        (!filter?.sourceId || m.sourceId === filter.sourceId) &&
        (!filter?.weighingPointId || m.weighingPointId === filter.weighingPointId)
    );
    return { itemList: filtered };
  }

  async delete(id: string): Promise<void> {
    await this.store.delete("measurement", id);
  }
}
