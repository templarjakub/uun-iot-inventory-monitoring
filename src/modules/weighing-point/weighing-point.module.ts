import { Module } from "@nestjs/common";
import { WeighingPointController } from "./weighing-point.controller";
import { WeighingPointService } from "./weighing-point.service";

@Module({
  controllers: [WeighingPointController],
  providers: [WeighingPointService]
})
export class WeighingPointModule {}
