import { Global, Module } from "@nestjs/common";
import { StoreService } from "./store.service";
import { ProductDao } from "./dao/product.dao";
import { WeighingPointDao } from "./dao/weighing-point.dao";
import { MeasurementDao } from "./dao/measurement.dao";
import { IotNodeDao } from "./dao/iot-node.dao";
import { IotGatewayDao } from "./dao/iot-gateway.dao";

@Global()
@Module({
  providers: [
    StoreService,
    ProductDao,
    WeighingPointDao,
    MeasurementDao,
    IotNodeDao,
    IotGatewayDao
  ],
  exports: [
    StoreService,
    ProductDao,
    WeighingPointDao,
    MeasurementDao,
    IotNodeDao,
    IotGatewayDao
  ]
})
export class PersistenceModule {}
