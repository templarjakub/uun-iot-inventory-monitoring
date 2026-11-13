import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from "@nestjs/swagger";
import { Request } from "express";
import { Profiles } from "../../common/decorators/profiles.decorator";
import { ProductService } from "./product.service";
import {
  ProductCalibrateUnitWeightDtoIn,
  ProductCalibrateUnitWeightDtoOut,
  ProductCreateDtoIn,
  ProductCreateDtoOut,
  ProductUpdateDtoIn,
  ProductUpdateDtoOut
} from "./product.dto";

@ApiTags("1. Products (BUC-01, BUC-02, BUC-06)")
@ApiHeader({
  name: "x-uu-profile",
  required: false,
  description: "Application Profile: Authorities (default: Authorities)"
})
@Controller("product")
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post("create")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary: "1. product/create (BUC-01) – Založí nový produkt",
    description:
      "Založí nový produkt (druh materiálu) s povinným názvem a vygenerovaným jednoznačným identifikátorem productId."
  })
  @ApiOkResponse({ type: ProductCreateDtoOut })
  async create(
    @Body() dtoIn: ProductCreateDtoIn,
    @Req() req: Request
  ): Promise<ProductCreateDtoOut> {
    return this.productService.create(dtoIn, req.body);
  }

  @Post("update")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "2. product/update (BUC-02, BUC-14) – Upraví název produktu a minimální zásobu",
    description:
      "Upraví název existujícího produktu nebo nastaví celkovou minimální zásobu (minimumStock) a spustí vyhodnocení nízké zásoby podle BUC-14."
  })
  @ApiOkResponse({ type: ProductUpdateDtoOut })
  async update(
    @Body() dtoIn: ProductUpdateDtoIn,
    @Req() req: Request
  ): Promise<ProductUpdateDtoOut> {
    return this.productService.update(dtoIn, req.body);
  }

  @Post("calibrateUnitWeight")
  @HttpCode(200)
  @Profiles("Authorities")
  @ApiOperation({
    summary:
      "6. product/calibrateUnitWeight (BUC-06) – Kalibruje průměrnou hmotnost kusu",
    description:
      "Kalibruje kladnou průměrnou hmotnost jednoho kusu produktu (unitWeight) ze známého počtu kusů (sampleCount) na místě s ověřenou tárou."
  })
  @ApiOkResponse({ type: ProductCalibrateUnitWeightDtoOut })
  async calibrateUnitWeight(
    @Body() dtoIn: ProductCalibrateUnitWeightDtoIn,
    @Req() req: Request
  ): Promise<ProductCalibrateUnitWeightDtoOut> {
    return this.productService.calibrateUnitWeight(dtoIn, req.body);
  }
}
