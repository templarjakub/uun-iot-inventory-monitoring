import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ProfilesGuard } from "./common/guards/profiles.guard";
import { UuAppExceptionFilter } from "./common/filters/uu-app-exception.filter";
import { PersistenceModule } from "./persistence/persistence.module";
import { StockOverviewModule } from "./modules/stock-overview/stock-overview.module";
import { ProductModule } from "./modules/product/product.module";
import { WeighingPointModule } from "./modules/weighing-point/weighing-point.module";
import { IotModule } from "./modules/iot/iot.module";
import { MeasurementModule } from "./modules/measurement/measurement.module";

@Module({
  imports: [
    PersistenceModule,
    StockOverviewModule,
    ProductModule,
    WeighingPointModule,
    IotModule,
    MeasurementModule
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ProfilesGuard
    },
    {
      provide: APP_FILTER,
      useClass: UuAppExceptionFilter
    }
  ]
})
export class AppModule {}
