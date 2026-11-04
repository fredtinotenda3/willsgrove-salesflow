import { RecordStatus } from "@prisma/client";

export type FieldErrors = Record<string, string>;

export type CustomerFields = {
  name: string;
  sapCustomerCode: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  notes: string | null;
};

export type LocationFields = {
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
};

export type CreateCustomerInput = CustomerFields & {
  location: LocationFields | null;
};

export type UpdateCustomerInput = Partial<CustomerFields> & {
  status?: RecordStatus;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; fieldErrors: FieldErrors };

type Source = Record<string, unknown>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]{5,30}$/;

// undefined = field not provided, null = provided but empty.
export function readText(
  source: Source,
  key: string,
  label: string,
  maxLength: number,
  errors: FieldErrors,
  errorKey: string = key
): string | null | undefined {
  const raw = source[key];

  if (raw === undefined) {
    return undefined;
  }

  if (raw === null) {
    return null;
  }

  if (typeof raw !== "string") {
    errors[errorKey] = `${label} must be text.`;
    return undefined;
  }

  const value = raw.trim();

  if (value === "") {
    return null;
  }

  if (value.length > maxLength) {
    errors[errorKey] = `${label} must be ${maxLength} characters or fewer.`;
    return undefined;
  }

  return value;
}

function readCustomerFields(
  source: Source,
  errors: FieldErrors
): Partial<CustomerFields> {
  const result: Partial<CustomerFields> = {};

  const name = readText(source, "name", "Name", 150, errors);

  if (name === null) {
    errors.name = "Name is required.";
  } else if (name !== undefined) {
    result.name = name;
  }

  const sapCustomerCode = readText(
    source,
    "sapCustomerCode",
    "SAP customer code",
    50,
    errors
  );

  if (sapCustomerCode !== undefined) {
    result.sapCustomerCode = sapCustomerCode;
  }

  const email = readText(source, "email", "Email", 254, errors);

  if (email !== undefined) {
    if (email !== null && !EMAIL_PATTERN.test(email)) {
      errors.email = "Email address is not valid.";
    } else {
      result.email = email;
    }
  }

  const phone = readText(source, "phone", "Phone", 30, errors);

  if (phone !== undefined) {
    if (phone !== null && !PHONE_PATTERN.test(phone)) {
      errors.phone =
        "Phone may only contain digits, spaces and + ( ) - . (5 to 30 characters).";
    } else {
      result.phone = phone;
    }
  }

  const category = readText(source, "category", "Category", 60, errors);

  if (category !== undefined) {
    result.category = category;
  }

  const notes = readText(source, "notes", "Notes", 1000, errors);

  if (notes !== undefined) {
    result.notes = notes;
  }

  return result;
}

function readLocationFields(
  source: Source,
  errors: FieldErrors
): LocationFields | null {
  const label = readText(source, "label", "Location label", 80, errors, "location.label");
  const addressLine1 = readText(
    source,
    "addressLine1",
    "Address line 1",
    200,
    errors,
    "location.addressLine1"
  );
  const addressLine2 = readText(
    source,
    "addressLine2",
    "Address line 2",
    200,
    errors,
    "location.addressLine2"
  );
  const city = readText(source, "city", "City", 80, errors, "location.city");
  const province = readText(
    source,
    "province",
    "Province",
    80,
    errors,
    "location.province"
  );

  if (!label && !errors["location.label"]) {
    errors["location.label"] = "Location label is required.";
  }

  if (!addressLine1 && !errors["location.addressLine1"]) {
    errors["location.addressLine1"] = "Address line 1 is required.";
  }

  if (!label || !addressLine1) {
    return null;
  }

  return {
    label,
    addressLine1,
    addressLine2: addressLine2 ?? null,
    city: city ?? null,
    province: province ?? null,
  };
}

export function validateCreateCustomer(
  body: Source
): ValidationResult<CreateCustomerInput> {
  const errors: FieldErrors = {};
  const fields = readCustomerFields(body, errors);

  if (fields.name === undefined && !errors.name) {
    errors.name = "Name is required.";
  }

  let location: LocationFields | null = null;
  const rawLocation = body.location;

  if (rawLocation !== undefined && rawLocation !== null) {
    if (typeof rawLocation !== "object" || Array.isArray(rawLocation)) {
      errors.location = "Location must be an object.";
    } else {
      location = readLocationFields(rawLocation as Source, errors);
    }
  }

  if (Object.keys(errors).length > 0 || fields.name === undefined) {
    return { ok: false, fieldErrors: errors };
  }

  return {
    ok: true,
    value: {
      name: fields.name,
      sapCustomerCode: fields.sapCustomerCode ?? null,
      email: fields.email ?? null,
      phone: fields.phone ?? null,
      category: fields.category ?? null,
      notes: fields.notes ?? null,
      location,
    },
  };
}

export function validateUpdateCustomer(
  body: Source
): ValidationResult<UpdateCustomerInput> {
  const errors: FieldErrors = {};
  const value: UpdateCustomerInput = readCustomerFields(body, errors);

  const rawStatus = body.status;

  if (rawStatus !== undefined) {
    if (rawStatus === "ACTIVE") {
      value.status = RecordStatus.ACTIVE;
    } else if (rawStatus === "INACTIVE") {
      value.status = RecordStatus.INACTIVE;
    } else {
      errors.status = "Status must be ACTIVE or INACTIVE.";
    }
  }

  if (Object.keys(errors).length === 0 && Object.keys(value).length === 0) {
    errors.form = "No changes provided.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, fieldErrors: errors };
  }

  return { ok: true, value };
}