import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException
} from "@nestjs/common";
import { CommandError } from "../utils/uu-app-error";

@Catch()
export class UuAppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const commandPath = (request.originalUrl || request.url || "")
      .split("?")[0]
      .replace(/^\//, "");

    if (exception instanceof CommandError) {
      return response.status(exception.statusCode).json({
        uuAppErrorMap: exception.toErrorMap()
      });
    }

    if (exception instanceof BadRequestException) {
      const resBody = exception.getResponse() as Record<string, unknown>;
      const messages = Array.isArray(resBody.message)
        ? resBody.message
        : [String(resBody.message || "Invalid input")];

      const invalidValueKeyMap: Record<string, string> = {};
      for (const msg of messages) {
        const field = String(msg).split(" ")[0] || "dtoIn";
        invalidValueKeyMap[field] = String(msg);
      }

      const code = `biot-inventory-main/${commandPath}/invalidDtoIn`;
      return response.status(400).json({
        uuAppErrorMap: {
          [code]: {
            type: "error",
            message: "DtoIn is not valid.",
            paramMap: {
              invalidTypeKeyMap: {},
              invalidValueKeyMap,
              missingKeyMap: {}
            }
          }
        }
      });
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof Error ? exception.message : "Unexpected server error.";

    return response.status(status).json({
      uuAppErrorMap: {
        [`biot-inventory-main/${commandPath}/unexpectedError`]: {
          type: "error",
          message,
          paramMap: {}
        }
      }
    });
  }
}
