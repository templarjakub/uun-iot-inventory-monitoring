/**
 * Standard uuAppErrorMap builder matching BIOT DL Application Model - Tým 4 (Command List)
 */
export interface UuAppErrorEntry {
  type: "error" | "warning";
  message: string;
  paramMap: Record<string, unknown>;
}

export type UuAppErrorMap = Record<string, UuAppErrorEntry>;

export class CommandError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly paramMap: Record<string, unknown>;

  constructor(
    commandName: string,
    code: string,
    message: string,
    paramMap: Record<string, unknown> = {},
    statusCode = 400
  ) {
    super(message);
    this.code = `biot-inventory-main/${commandName}/${code}`;
    this.paramMap = paramMap;
    this.statusCode = statusCode;
  }

  toErrorMap(existingMap: UuAppErrorMap = {}): UuAppErrorMap {
    return {
      ...existingMap,
      [this.code]: {
        type: "error",
        message: this.message,
        paramMap: this.paramMap
      }
    };
  }
}

export function addWarning(
  errorMap: UuAppErrorMap,
  commandName: string,
  code: string,
  message: string,
  paramMap: Record<string, unknown> = {}
): UuAppErrorMap {
  const fullCode = `biot-inventory-main/${commandName}/${code}`;
  errorMap[fullCode] = {
    type: "warning",
    message,
    paramMap
  };
  return errorMap;
}

export function checkUnsupportedKeys(
  rawDtoIn: unknown,
  allowedKeys: string[],
  commandName: string,
  errorMap: UuAppErrorMap = {}
): UuAppErrorMap {
  if (!rawDtoIn || typeof rawDtoIn !== "object" || Array.isArray(rawDtoIn)) {
    return errorMap;
  }
  const unsupportedKeyList = Object.keys(rawDtoIn).filter(
    (key) => !allowedKeys.includes(key)
  );
  if (unsupportedKeyList.length > 0) {
    addWarning(
      errorMap,
      commandName,
      "unsupportedKeys",
      "DtoIn contains unsupported keys.",
      { unsupportedKeyList }
    );
  }
  return errorMap;
}
