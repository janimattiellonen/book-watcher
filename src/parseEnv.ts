import type { z } from 'zod';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Parses an environment against a schema, or throws.
 *
 * Every missing or invalid variable is reported at once, by name, so one restart is
 * enough to see all of them.
 */
export function parseEnv<T>(name: string, schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(env);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(`Invalid ${name} configuration:\n${lines.join('\n')}`);
  }

  return result.data;
}
