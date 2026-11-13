import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import { IotNode, NodeMeasurementStatus } from "../schemas/iot-node.schema";
import { StoreService, generateObjectId } from "../store.service";

@Injectable()
export class IotNodeDao {
  constructor(private readonly store: StoreService) {}

  async create(data: {
    nodeId: string;
    nodeName: string;
    sourceIds: string[];
    gatewayId: string;
    measurementStatus: NodeMeasurementStatus;
  }): Promise<IotNode> {
    const now = new Date().toISOString();
    const entity: IotNode = {
      id: generateObjectId(),
      awid: env.AWID,
      ...data,
      sys: { cts: now, mts: now, rev: 0 }
    };
    return this.store.insert("iotNode", entity);
  }

  async get(filter: {
    id?: string;
    nodeId?: string;
    sourceId?: string;
  }): Promise<IotNode | null> {
    const all = await this.store.list("iotNode");
    return (
      all.find(
        (n) =>
          (filter.id && n.id === filter.id) ||
          (filter.nodeId && n.nodeId === filter.nodeId) ||
          (filter.sourceId && n.sourceIds.includes(filter.sourceId))
      ) ?? null
    );
  }

  async list(): Promise<{ itemList: IotNode[] }> {
    const itemList = await this.store.list("iotNode");
    return { itemList };
  }

  async update(
    id: string,
    patch: Partial<
      Pick<IotNode, "nodeName" | "sourceIds" | "gatewayId" | "measurementStatus">
    >
  ): Promise<IotNode | null> {
    return this.store.update("iotNode", id, (existing) => ({
      ...existing,
      ...patch
    }));
  }

  async delete(id: string): Promise<void> {
    await this.store.delete("iotNode", id);
  }
}
