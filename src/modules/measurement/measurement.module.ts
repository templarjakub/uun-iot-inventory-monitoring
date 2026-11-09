import { Module } from "@nestjs/common";
import { MeasurementController } from "./measurement.controller";
import { MeasurementService } from "./measurement.service";

@Module({
  controllers: [MeasurementController],
  providers: [MeasurementService]
})
export class MeasurementModule {}
