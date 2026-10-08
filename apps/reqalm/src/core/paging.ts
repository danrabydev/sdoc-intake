import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const MAX_PAGE_OFFSET = 100_000;
export const DEFAULT_PAGE_SIZE = 20;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.coerce.number().int().min(0).max(MAX_PAGE_OFFSET).default(0),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export type PageResult<T> = {
  items: T[];
  limit: number;
  offset: number;
  total: number;
};
