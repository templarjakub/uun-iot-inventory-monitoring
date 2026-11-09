import { Global, Module } from "@nestjs/common";
import { StockEvaluationService } from "./stock-evaluation.service";
import { StockOverviewController } from "./stock-overview.controller";

@Global()
@Module({
  controllers: [StockOverviewController],
  providers: [StockEvaluationService],
  exports: [StockEvaluationService]
})
export class StockOverviewModule {}
