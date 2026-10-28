import type { Stamp } from "@/lib/types";

export type { Stamp };

/** A row as returned by the database layer: fields camelCased, id exposed as _id. */
export type WithId<T> = T & { _id: string };

export interface Attachment {
  url: string;
  name: string;
  size: number;
  contentType?: string | null;
  uploadedBy?: Stamp | null;
}
