import {
  readText,
  type FieldErrors,
  type LocationFields,
  type ValidationResult,
} from "@/lib/customer-validation";

export type CreateLocationInput = LocationFields & { makeDefault: boolean };

export type UpdateLocationInput = Partial<LocationFields> & {
  isDefault?: true;
  isActive?: boolean;
};

type Source = Record<string, unknown>;

function readFlag(
  source: Source,
  key: string,
  label: string,
  errors: FieldErrors
): boolean | undefined {
  const raw = source[key];

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== "boolean") {
    errors[key] = `${label} must be true or false.`;
    return undefined;
  }

  return raw;
}

function readLocationText(source: Source, errors: FieldErrors) {
  return {
    label: readText(source, "label", "Location label", 80, errors),
    addressLine1: readText(source, "addressLine1", "Address line 1", 200, errors),
    addressLine2: readText(source, "addressLine2", "Address line 2", 200, errors),
    city: readText(source, "city", "City", 80, errors),
    province: readText(source, "province", "Province", 80, errors),
  };
}

export function validateCreateLocation(
  body: Source
): ValidationResult<CreateLocationInput> {
  const errors: FieldErrors = {};
  const text = readLocationText(body, errors);
  const isDefault = readFlag(body, "isDefault", "isDefault", errors);

  if (!text.label && !errors.label) {
    errors.label = "Location label is required.";
  }

  if (!text.addressLine1 && !errors.addressLine1) {
    errors.addressLine1 = "Address line 1 is required.";
  }

  if (Object.keys(errors).length > 0 || !text.label || !text.addressLine1) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    value: {
      label: text.label,
      addressLine1: text.addressLine1,
      addressLine2: text.addressLine2 ?? null,
      city: text.city ?? null,
      province: text.province ?? null,
      makeDefault: isDefault === true,
    },
  };
}

export function validateUpdateLocation(
  body: Source
): ValidationResult<UpdateLocationInput> {
  const errors: FieldErrors = {};
  const text = readLocationText(body, errors);
  const isDefault = readFlag(body, "isDefault", "isDefault", errors);
  const isActive = readFlag(body, "isActive", "isActive", errors);
  const value: UpdateLocationInput = {};

  if (text.label === null) {
    errors.label = "Location label is required.";
  } else if (text.label !== undefined) {
    value.label = text.label;
  }

  if (text.addressLine1 === null) {
    errors.addressLine1 = "Address line 1 is required.";
  } else if (text.addressLine1 !== undefined) {
    value.addressLine1 = text.addressLine1;
  }

  if (text.addressLine2 !== undefined) {
    value.addressLine2 = text.addressLine2;
  }

  if (text.city !== undefined) {
    value.city = text.city;
  }

  if (text.province !== undefined) {
    value.province = text.province;
  }

  if (isDefault === false) {
    errors.isDefault =
      "To change the default, make another location the default instead.";
  } else if (isDefault === true) {
    value.isDefault = true;
  }

  if (isActive !== undefined) {
    value.isActive = isActive;
  }

  if (value.isDefault === true && value.isActive === false) {
    errors.isActive = "A location cannot be made default and deactivated at once.";
  }

  if (Object.keys(errors).length === 0 && Object.keys(value).length === 0) {
    errors.form = "No changes provided.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return { ok: true, value };
}