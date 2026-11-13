import { Injectable } from "@nestjs/common";
import { env } from "../../common/config/env";
import {
  IotGateway,
  GatewayAuthStatus,
  GatewayDeliveryState
} from "../schemas/iot-gateway.schema";
import { StoreService, generateObjectId } from "../store.service";

@Injectable()
export class IotGatewayDao {
  constructor(private readonly store: StoreService) {}

  async create(data: {
    gatewayId: string;
    gatewayName: string;
    authorizationStatus: GatewayAuthStatus;
  }): Promise<IotGateway> {
    const now = new Date().toISOString();
    const entity: IotGateway = {
      id: generateObjectId(),
      awid: env.AWID,
      gatewayId: data.gatewayId,
      gatewayName: data.gatewayName,
      authorizationStatus: data.authorizationStatus,
      nodeIds: [],
      deliveryState: "idle",
      sys: { cts: now, mts: now, rev: 0 }
    };
    return this.store.insert("iotGateway", entity);
  }

  async get(filter: { id?: string; gatewayId?: string }): Promise<IotGateway | null> {
    const all = await this.store.list("iotGateway");
    return (
      all.find(
        (g) =>
          (filter.id && g.id === filter.id) ||
          (filter.gatewayId && g.gatewayId === filter.gatewayId)
      ) ?? null
    );
  }

  async list(): Promise<{ itemList: IotGateway[] }> {
    const itemList = await this.store.list("iotGateway");
    return { itemList };
  }

  async update(
    id: string,
    patch: Partial<
      Pick<
        IotGateway,
        "gatewayName" | "authorizationStatus" | "nodeIds" | "deliveryState"
      >
    >
  ): Promise<IotGateway | null> {
    return this.store.update("iotGateway", id, (existing) => ({
      ...existing,
      ...patch
    }));
  }

  async delete(id: string): Promise<void> {
    await this.store.delete("iotGateway", id);
  }
}
