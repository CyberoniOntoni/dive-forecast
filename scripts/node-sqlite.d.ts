/**
 * The part of Node's built-in SQLite module the dev scripts use (Node 22.5+). @types/node for Node 20 does not
 * declare it; drop this file once the project's Node types include "node:sqlite".
 */
declare module "node:sqlite" {
  export class StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
