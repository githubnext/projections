import type {Comparison, Extraction, ProjectionEngine} from '@githubnext/projections-schemas'
/**
 * Compares two extractions with a comparator file the way hosts do: the rules interpreter, in a Worker, computes the
 * default baseline and the comparator's comparison, and `engine` validates it against both extractions.
 *
 * @param engine - The native engine, which validates the result.
 * @param rules - The path or file URL of a `.comparator.yaml` file, read synchronously.
 * @param options - The comparator's options (default `{}`).
 * @throws If the file can't be read, the comparator is invalid or fails, or its result fails validation.
 */
export declare function compareWithRules(
  engine: ProjectionEngine,
  before: Extraction,
  after: Extraction,
  rules: string | URL,
  options?: unknown,
): Promise<Comparison>
/** The example comparator file that moves the steps changing `options.priority` entities to the front. */
export declare const priorityOrderRules: URL
