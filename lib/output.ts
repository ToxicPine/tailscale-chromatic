// =============================================================================
// Output - Unified Output Handling for CLI Commands
// =============================================================================

import { statusOk, statusErr, statusInfo, statusWarn, bold, dim } from "./cli.ts";

// =============================================================================
// Output Class
// =============================================================================

export class Output<T extends Record<string, unknown>> {
  private data: Partial<T>;
  private jsonMode: boolean;

  constructor(jsonMode: boolean, initialData?: Partial<T>) {
    this.jsonMode = jsonMode;
    this.data = initialData ?? {};
  }

  // Set or update result data
  set<K extends keyof T>(key: K, value: T[K]): this {
    this.data[key] = value;
    return this;
  }

  // Merge data object
  merge(data: Partial<T>): this {
    Object.assign(this.data, data);
    return this;
  }

  // Status messages - print immediately in human mode, no-op in JSON mode
  ok(text: string): this {
    if (!this.jsonMode) statusOk(text);
    return this;
  }

  err(text: string): this {
    if (!this.jsonMode) statusErr(text);
    return this;
  }

  info(text: string): this {
    if (!this.jsonMode) statusInfo(text);
    return this;
  }

  warn(text: string): this {
    if (!this.jsonMode) statusWarn(text);
    return this;
  }

  // Plain text
  text(text: string): this {
    if (!this.jsonMode) console.log(text);
    return this;
  }

  // Dim text
  dim(text: string): this {
    if (!this.jsonMode) console.log(dim(text));
    return this;
  }

  // Bold header
  header(text: string): this {
    if (!this.jsonMode) console.log(bold(text));
    return this;
  }

  // Blank line
  blank(): this {
    if (!this.jsonMode) console.log();
    return this;
  }

  // Output JSON data (no-op in human mode)
  print(): void {
    if (this.jsonMode) {
      console.log(JSON.stringify(this.data, null, 2));
    }
  }

  // Get data for further processing
  getData(): Partial<T> {
    return this.data;
  }

  // Check if in JSON mode
  isJson(): boolean {
    return this.jsonMode;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createOutput<T extends Record<string, unknown>>(
  jsonMode: boolean,
  initialData?: Partial<T>
): Output<T> {
  return new Output(jsonMode, initialData);
}
