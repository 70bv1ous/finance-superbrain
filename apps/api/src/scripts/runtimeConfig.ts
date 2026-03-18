const resolveFiniteNumber = (
  value: string | number | undefined,
  fallback: number,
) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const resolveBoundedRuntimeNumber = (input: {
  value: string | number | undefined;
  fallback: number;
  minimum: number;
  maximum?: number;
}) => {
  const normalized = resolveFiniteNumber(input.value, input.fallback);
  const bounded = Math.max(input.minimum, normalized);

  if (input.maximum === undefined) {
    return Math.floor(bounded);
  }

  return Math.floor(Math.min(input.maximum, bounded));
};

export const resolveOptionalRuntimeNumber = (input: {
  value: string | number | undefined;
  minimum: number;
  maximum?: number;
}) => {
  if (input.value === undefined) {
    return undefined;
  }

  const normalized = resolveFiniteNumber(input.value, Number.NaN);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return undefined;
  }

  const bounded = Math.max(input.minimum, normalized);

  if (input.maximum === undefined) {
    return Math.floor(bounded);
  }

  return Math.floor(Math.min(input.maximum, bounded));
};
